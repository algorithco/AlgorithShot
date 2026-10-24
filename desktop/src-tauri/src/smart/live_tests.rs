//! Tests against the real Windows engines: text drawn with GDI is read back
//! by Windows OCR, then checked by the privacy patterns. Plus the QR reader.
//! All values are made up.

use image::{Rgba, RgbaImage};
use windows::core::w;
use windows::Win32::Foundation::COLORREF;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GdiFlush, SelectObject, SetBkMode, SetTextColor,
    TextOutW, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS,
    OUT_DEFAULT_PRECIS, TRANSPARENT,
};

use super::{init_thread, ocr, privacy, qr};

/// Black-ish text on white, one string per line, like a screenshot of a form.
fn render_text(lines: &[&str], size: i32) -> RgbaImage {
    let (w, h) = (1000, (size + 16) * lines.len() as i32 + 24);
    unsafe {
        let dc = CreateCompatibleDC(None);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bmp = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).expect("DIB");
        let old = SelectObject(dc, bmp.into());
        let buf = std::slice::from_raw_parts_mut(bits as *mut u8, (w * h * 4) as usize);
        buf.fill(255);
        let font = CreateFontW(-size, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, 0, w!("Segoe UI"));
        let old_font = SelectObject(dc, font.into());
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, COLORREF(0x0020_2020));
        for (i, line) in lines.iter().enumerate() {
            let wide: Vec<u16> = line.encode_utf16().collect();
            let _ = TextOutW(dc, 16, 12 + i as i32 * (size + 16), &wide);
        }
        let _ = GdiFlush();
        let img = RgbaImage::from_fn(w as u32, h as u32, |x, y| {
            let i = ((y * w as u32 + x) * 4) as usize;
            Rgba([buf[i + 2], buf[i + 1], buf[i], 255])
        });
        SelectObject(dc, old_font);
        SelectObject(dc, old);
        let _ = DeleteObject(font.into());
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(dc);
        img
    }
}

#[test]
fn ocr_reads_text_and_privacy_finds_items() {
    init_thread();
    let img = render_text(
        &[
            "Invoice 42 paid by test.user@example.uz",
            "Tel: +998 90 123 45 67",
            "Karta: 8600 1234 5678 9012",
        ],
        20,
    );
    let results = ocr::read(&img).expect("Windows OCR should be available");
    let text = results[0].text();
    assert!(text.contains("Invoice"), "read: {text}");

    let found = privacy::find_in_text(&results);
    let kinds: Vec<&str> = found.iter().map(|f| f.kind.as_str()).collect();
    for want in ["email", "phone", "card"] {
        assert!(kinds.contains(&want), "missing {want}: {kinds:?} in {text:?}");
    }
    // Each box sits on its own line of the picture.
    let line_of = |kind: &str| found.iter().find(|f| f.kind == kind).map(|f| f.rect.y / 36).unwrap();
    assert!(line_of("email") < line_of("phone") && line_of("phone") < line_of("card"));
}

#[test]
fn russian_engine_reads_cyrillic() {
    init_thread();
    if !ocr::languages().iter().any(|l| l.to_ascii_lowercase().starts_with("ru")) {
        return; // no Russian OCR on this PC
    }
    let img = render_text(&["Оплата прошла успешно, Ташкент"], 24);
    let all = ocr::union_text(&ocr::read(&img).unwrap()).to_lowercase();
    assert!(all.contains("оплата") && all.contains("ташкент"), "read: {all}");
}

#[test]
fn scans_a_qr_code() {
    let code = qrcode::QrCode::new(b"https://algorithco.com/shot").unwrap();
    let luma = code.render::<image::Luma<u8>>().min_dimensions(240, 240).build();
    let img = image::DynamicImage::ImageLuma8(luma).to_rgba8();
    assert_eq!(qr::scan(&img), vec!["https://algorithco.com/shot".to_string()]);
}
