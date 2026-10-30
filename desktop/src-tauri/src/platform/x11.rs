//! Still-image X11 capture; no PipeWire video or Wayland output dependency.

use anyhow::{Context, Result, bail};
use image::RgbaImage;
use x11rb::{connection::Connection, image::{Image, PixelLayout},
    protocol::xproto::{AtomEnum, ConnectionExt, MapState, Window}, rust_connection::RustConnection};
use crate::win::{Rect, WindowInfo};

pub fn capture(rect: Rect) -> Result<RgbaImage> {
    if rect.w <= 0 || rect.h <= 0 { bail!("The selected display is empty"); }
    let (connection, screen) = x11rb::connect(None).context("Could not connect to the X11 desktop")?;
    let screen = &connection.setup().roots[screen];
    let (image, visual) = Image::get(&connection, screen.root, rect.x.try_into()?, rect.y.try_into()?,
        rect.w.try_into()?, rect.h.try_into()?).context("Could not read pixels from the X11 display")?;
    let visual = screen.allowed_depths.iter().flat_map(|depth| &depth.visuals)
        .find(|v| v.visual_id == visual).context("The display uses an unknown pixel format")?;
    let layout = PixelLayout::from_visual_type(*visual).context("The display's color format is unsupported")?;
    Ok(to_rgba(&image, layout))
}

fn to_rgba(image: &Image<'_>, layout: PixelLayout) -> RgbaImage {
    RgbaImage::from_fn(image.width().into(), image.height().into(), |x, y| {
        let (red, green, blue) = layout.decode(image.get_pixel(x as u16, y as u16));
        image::Rgba([(red >> 8) as u8, (green >> 8) as u8, (blue >> 8) as u8, 255])
    })
}

fn property(connection: &RustConnection, window: Window, name: &str) -> Option<x11rb::protocol::xproto::GetPropertyReply> {
    let atom = connection.intern_atom(true, name.as_bytes()).ok()?.reply().ok()?.atom;
    if atom == 0 { return None; }
    connection.get_property(false, window, atom, AtomEnum::ANY, 0, 4096).ok()?.reply().ok()
}

fn cardinals(connection: &RustConnection, window: Window, name: &str) -> Option<Vec<u32>> {
    Some(property(connection, window, name)?.value32()?.collect())
}

fn title(connection: &RustConnection, window: Window) -> String {
    let utf8 = property(connection, window, "_NET_WM_NAME").filter(|p| !p.value.is_empty());
    let name = utf8.or_else(|| property(connection, window, "WM_NAME"));
    name.map(|p| String::from_utf8_lossy(&p.value).trim_end_matches('\0').to_owned()).unwrap_or_default()
}

pub fn window_pid(id: isize) -> Option<u32> {
    let (connection, _) = x11rb::connect(None).ok()?;
    cardinals(&connection, id.try_into().ok()?, "_NET_WM_PID")?.first().copied()
}

pub fn windows() -> Vec<WindowInfo> {
    windows_inner().unwrap_or_else(|error| { log::warn!("X11 window list: {error:#}"); vec![] })
}

fn windows_inner() -> Result<Vec<WindowInfo>> {
    let (connection, screen) = x11rb::connect(None)?;
    let root = connection.setup().roots[screen].root;
    let windows = cardinals(&connection, root, "_NET_CLIENT_LIST_STACKING")
        .filter(|list| !list.is_empty()).unwrap_or(connection.query_tree(root)?.reply()?.children);
    let mut output = vec![];
    for window in windows.into_iter().rev() {
        let Ok(attributes) = connection.get_window_attributes(window)?.reply() else { continue; };
        if attributes.map_state != MapState::VIEWABLE { continue; }
        if cardinals(&connection, window, "_NET_WM_PID").and_then(|p| p.first().copied()) == Some(std::process::id()) { continue; }
        let Ok(geometry) = connection.get_geometry(window)?.reply() else { continue; };
        let Ok(origin) = connection.translate_coordinates(window, root, 0, 0)?.reply() else { continue; };
        let mut rect = Rect::new(origin.dst_x.into(), origin.dst_y.into(), geometry.width.into(), geometry.height.into());
        if rect.w < 4 || rect.h < 4 { continue; }
        if let Some(extents) = cardinals(&connection, window, "_NET_FRAME_EXTENTS").filter(|v| v.len() == 4) {
            // left, right, top, bottom: include the visible window decoration.
            let extents: Vec<_> = extents.into_iter().map(|n| n.min(4096) as i32).collect();
            rect.x -= extents[0]; rect.y -= extents[2];
            rect.w += extents[0] + extents[1]; rect.h += extents[2] + extents[3];
        }
        let class = property(&connection, window, "WM_CLASS").map(|p| {
            p.value.split(|b| *b == 0).filter(|s| !s.is_empty()).last()
                .map(|s| String::from_utf8_lossy(s).into_owned()).unwrap_or_default()
        }).unwrap_or_default();
        output.push(WindowInfo { hwnd: window as isize, rect, title: title(&connection, window), app: class.clone(), class });
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;
    use x11rb::image::{BitsPerPixel, ColorComponent, ImageOrder, ScanlinePad};

    #[test]
    fn captures_16_bit_padded_rows_and_30_bit_desktop_colors() {
        let image = Image::new(1, 2, ScanlinePad::Pad32, 16, BitsPerPixel::B16,
            ImageOrder::LsbFirst, Cow::Owned(vec![0x00, 0xf8, 0, 0, 0x1f, 0x00, 0, 0])).unwrap();
        let layout = PixelLayout::new(ColorComponent::from_mask(0xf800).unwrap(), ColorComponent::from_mask(0x07e0).unwrap(), ColorComponent::from_mask(0x001f).unwrap());
        let result = to_rgba(&image, layout);
        assert_eq!(result.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(result.get_pixel(0, 1).0, [0, 0, 255, 255]);
        let image = Image::new(1, 1, ScanlinePad::Pad32, 30, BitsPerPixel::B32,
            ImageOrder::MsbFirst, Cow::Owned(0x3ff0_0000u32.to_be_bytes().to_vec())).unwrap();
        let layout = PixelLayout::new(ColorComponent::from_mask(0x3ff00000).unwrap(), ColorComponent::from_mask(0x000ffc00).unwrap(), ColorComponent::from_mask(0x000003ff).unwrap());
        assert_eq!(to_rgba(&image, layout).get_pixel(0, 0).0, [255, 0, 0, 255]);
    }
}
