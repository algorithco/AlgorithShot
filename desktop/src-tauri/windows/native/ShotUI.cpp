// AlgorithShot's NSIS button renderer. These remain standard Win32 Buttons:
// keyboard navigation, accelerators, UI Automation and click handling stay native.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <richedit.h>
#include <uxtheme.h>
#include <cstdlib>
#include <cwchar>
#include <cstdio>
#include <initializer_list>
#include <new>

namespace {
constexpr UINT_PTR kSubclass = 0x53484f54;
constexpr COLORREF kPaper = RGB(255, 255, 255);
constexpr COLORREF kInk = RGB(23, 26, 33);
constexpr COLORREF kMuted = RGB(98, 104, 114);
constexpr COLORREF kBorder = RGB(228, 231, 236);
constexpr COLORREF kYellow = RGB(255, 211, 0);
constexpr int kLeft = 40;
constexpr int kContent = 660;
constexpr int kFooter = 68;
HFONT gBody = nullptr, gTitle = nullptr, gLabel = nullptr, gSmall = nullptr, gBrand = nullptr;
int gDpi = 96;
struct ButtonStyle { bool primary; bool hover = false; };
// Public NSIS Unicode plug-in stack ABI. The host owns stack allocations.
struct Stack { Stack* next; wchar_t text[1]; };

bool Pop(Stack** top, wchar_t* value, int capacity) {
  if (!top || !*top) return false;
  Stack* entry = *top;
  lstrcpynW(value, entry->text, capacity);
  *top = entry->next;
  GlobalFree(entry);
  return true;
}

int Px(int value) { return MulDiv(value, gDpi, 96); }
HFONT Font(int size, int weight, const wchar_t* family = L"Segoe UI") {
  return CreateFontW(-Px(size), 0, 0, 0, weight, FALSE, FALSE, FALSE,
    DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
    DEFAULT_PITCH, family);
}
void Move(HWND control, int x, int y, int width, int height) {
  SetWindowPos(control, nullptr, Px(x), Px(y), Px(width), Px(height),
    SWP_NOZORDER | SWP_NOACTIVATE);
}
void Text(HDC dc, const wchar_t* value, int x, int y, int width, int height,
    HFONT font, COLORREF color, UINT format = DT_LEFT | DT_TOP | DT_WORDBREAK | DT_NOPREFIX) {
  RECT rect{Px(x), Px(y), Px(x + width), Px(y + height)};
  HGDIOBJ old = SelectObject(dc, font);
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, color);
  DrawTextW(dc, value, -1, &rect, format);
  SelectObject(dc, old);
}
void Line(HDC dc, int x1, int y1, int x2, int y2, COLORREF color, int width = 1) {
  HPEN pen = CreatePen(PS_SOLID, Px(width), color);
  HGDIOBJ old = SelectObject(dc, pen);
  MoveToEx(dc, Px(x1), Px(y1), nullptr);
  LineTo(dc, Px(x2), Px(y2));
  SelectObject(dc, old);
  DeleteObject(pen);
}
void Box(HDC dc, int x, int y, int width, int height, COLORREF fill,
    COLORREF border, int radius = 8) {
  HBRUSH brush = CreateSolidBrush(fill);
  HPEN pen = CreatePen(PS_SOLID, Px(1), border);
  const HGDIOBJ oldBrush = SelectObject(dc, brush), oldPen = SelectObject(dc, pen);
  RoundRect(dc, Px(x), Px(y), Px(x + width), Px(y + height), Px(radius), Px(radius));
  SelectObject(dc, oldBrush);
  SelectObject(dc, oldPen);
  DeleteObject(brush);
  DeleteObject(pen);
}
void Mark(HDC dc, int x, int y, int size, COLORREF color) {
  const int inset = size / 4, edge = size / 5, thick = max(2, size / 14);
  for (int i = 0; i < 4; ++i) {
    const int cx = x + (i & 1 ? size - inset : inset);
    const int cy = y + (i & 2 ? size - inset : inset);
    Line(dc, cx, cy, cx + (i & 1 ? -edge : edge), cy, color, thick);
    Line(dc, cx, cy, cx, cy + (i & 2 ? -edge : edge), color, thick);
  }
  HBRUSH brush = CreateSolidBrush(kYellow);
  HGDIOBJ oldBrush = SelectObject(dc, brush);
  HGDIOBJ oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
  const int radius = size * 11 / 100;
  Ellipse(dc, Px(x + size / 2 - radius), Px(y + size / 2 - radius),
    Px(x + size / 2 + radius), Px(y + size / 2 + radius));
  SelectObject(dc, oldPen);
  SelectObject(dc, oldBrush);
  DeleteObject(brush);
}
// Decoration lives behind the native controls, never intercepting their input.
LRESULT CALLBACK CanvasProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp,
    UINT_PTR id, DWORD_PTR kind) {
  if (message == WM_PAINT || message == WM_PRINTCLIENT) {
    PAINTSTRUCT paint{};
    HDC dc = message == WM_PAINT ? BeginPaint(hwnd, &paint) : reinterpret_cast<HDC>(wp);
    RECT rect{};
    GetClientRect(hwnd, &rect);
    HBRUSH brush = CreateSolidBrush(kind == 1 ? RGB(248, 249, 251) : kPaper);
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
    const int width = MulDiv(rect.right, 96, gDpi);
    if (kind == 1) {
      Line(dc, 0, 0, width, 0, kBorder);
    } else if (kind == 2) {
      Box(dc, 0, 0, width, MulDiv(rect.bottom, 96, gDpi), RGB(248, 249, 251), kBorder, 12);
    } else if (kind == 6) {
      const HWND edit = reinterpret_cast<HWND>(GetPropW(hwnd, L"ShotEdit"));
      Box(dc, 0, 0, width, MulDiv(rect.bottom, 96, gDpi), kPaper,
        GetFocus() == edit ? kInk : RGB(187, 193, 202), 8);
    } else if (kind >= 3) {
      Box(dc, 0, 0, 40, 40, RGB(255, 248, 214), RGB(255, 248, 214), 12);
      if (kind == 3) {
        Mark(dc, 1, 1, 38, kInk);
      } else if (kind == 4) {
        Line(dc, 13, 26, 27, 12, kInk, 2);
        Line(dc, 16, 29, 30, 15, kInk, 2);
        Line(dc, 13, 26, 12, 30, kInk, 2);
        Line(dc, 12, 30, 16, 29, kInk, 2);
        Line(dc, 24, 14, 28, 18, kInk, 2);
      } else {
        HPEN pen = CreatePen(PS_SOLID, Px(2), kInk);
        const HGDIOBJ oldPen = SelectObject(dc, pen);
        const HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
        Ellipse(dc, Px(10), Px(9), Px(27), Px(26));
        SelectObject(dc, oldBrush);
        SelectObject(dc, oldPen);
        DeleteObject(pen);
        Line(dc, 25, 24, 31, 30, kInk, 2);
      }
    } else {
      Box(dc, 40, 23, 36, 36, kInk, kInk, 10);
      Mark(dc, 40, 23, 36, kPaper);
      Text(dc, L"AlgorithShot", 88, 20, 260, 27, gBrand, kInk);
      wchar_t version[80]{};
      GetWindowTextW(hwnd, version, 80);
      Text(dc, version, 88, 47, 260, 20, gSmall, kMuted);
      Line(dc, 40, 87, width - 40, 87, kBorder);
    }
    if (message == WM_PAINT) EndPaint(hwnd, &paint);
    return 0;
  }
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_NCDESTROY) {
    RemovePropW(hwnd, L"ShotEdit");
    RemoveWindowSubclass(hwnd, CanvasProc, id);
  }
  return DefSubclassProc(hwnd, message, wp, lp);
}

HWND Canvas(HWND page, int id, int kind, int x, int y, int width, int height) {
  HWND canvas = GetDlgItem(page, id);
  if (!canvas) {
    canvas = CreateWindowExW(0, L"Static", L"", WS_CHILD | WS_VISIBLE,
      0, 0, 0, 0, page, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), nullptr, nullptr);
    SetWindowSubclass(canvas, CanvasProc, kSubclass, static_cast<DWORD_PTR>(kind));
  }
  Move(canvas, x, y, width, height);
  SetWindowPos(canvas, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  return canvas;
}

HWND Label(HWND page, int id, const wchar_t* text, int x, int y, int w, int h, HFONT font) {
  HWND label = GetDlgItem(page, id);
  if (!label) label = CreateWindowExW(0, L"Static", text, WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
    0, 0, 0, 0, page, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), nullptr, nullptr);
  SetWindowTextW(label, text);
  SendMessageW(label, WM_SETFONT, reinterpret_cast<WPARAM>(font), FALSE);
  Move(label, x, y, w, h);
  return label;
}

void Surface(HWND parent, HWND inner) {
  RECT client{};
  GetClientRect(parent, &client);
  SetWindowPos(inner, nullptr, 0, 0, client.right, client.bottom - Px(kFooter),
    SWP_NOZORDER | SWP_NOACTIVATE);
  // Every page gets the same canvas. Hide the default wizard's top header,
  // separator and branding, including ones MUI restores between pages.
  for (const int id : {1037, 1038, 1034, 1035, 1036, 1039, 1046, 1028, 1045, 1256})
    ShowWindow(GetDlgItem(parent, id), SW_HIDE);
  Canvas(inner, 1900, 0, 0, 0, MulDiv(client.right, 96, gDpi), 88);
  Canvas(parent, 1899, 1, 0, MulDiv(client.bottom, 96, gDpi) - kFooter,
    MulDiv(client.right, 96, gDpi), kFooter);
}

void Heading(HWND page, const wchar_t* title, const wchar_t* description, const wchar_t* eyebrow) {
  Label(page, 1901, eyebrow, kLeft, 104, kContent, 20, gSmall);
  Label(page, 1902, title, kLeft, 128, kContent, 42, gTitle);
  Label(page, 1903, description, kLeft, 180, kContent, 44, gBody);
}

void Paint(HWND button, HDC dc, const ButtonStyle& style) {
  RECT bounds{};
  GetClientRect(button, &bounds);
  HBRUSH background = CreateSolidBrush(GetParent(button) == GetAncestor(button, GA_ROOT)
    ? RGB(248, 249, 251) : kPaper);
  FillRect(dc, &bounds, background);
  DeleteObject(background);
  const bool enabled = IsWindowEnabled(button) != FALSE;
  const bool pressed = (SendMessageW(button, BM_GETSTATE, 0, 0) & BST_PUSHED) != 0;
  const COLORREF fill = !enabled ? RGB(238, 240, 243) : style.primary
    ? (pressed ? RGB(242, 195, 0) : style.hover ? RGB(249, 203, 0) : kYellow)
    : (style.hover || pressed ? RGB(241, 243, 246) : kPaper);
  HBRUSH brush = CreateSolidBrush(fill);
  HPEN pen = CreatePen(PS_SOLID, Px(1), style.primary ? fill : kBorder);
  const HGDIOBJ oldBrush = SelectObject(dc, brush);
  const HGDIOBJ oldPen = SelectObject(dc, pen);
  RoundRect(dc, 0, 0, bounds.right, bounds.bottom, Px(8), Px(8));
  SelectObject(dc, oldBrush);
  SelectObject(dc, oldPen);
  DeleteObject(brush);
  DeleteObject(pen);

  wchar_t text[256]{};
  GetWindowTextW(button, text, 256);
  HFONT font = reinterpret_cast<HFONT>(SendMessageW(button, WM_GETFONT, 0, 0));
  const HGDIOBJ oldFont = SelectObject(dc, font ? font : GetStockObject(DEFAULT_GUI_FONT));
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, enabled ? kInk : RGB(140, 146, 156));
  RECT textBounds = bounds;
  InflateRect(&textBounds, -5, -2);
  UINT format = DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS;
  const LRESULT uiState = SendMessageW(button, WM_QUERYUISTATE, 0, 0);
  if (uiState & UISF_HIDEACCEL) format |= DT_HIDEPREFIX;
  DrawTextW(dc, text, -1, &textBounds, format);
  SelectObject(dc, oldFont);
  if (GetFocus() == button && !(uiState & UISF_HIDEFOCUS)) {
    RECT focus = bounds;
    InflateRect(&focus, -4, -4);
    DrawFocusRect(dc, &focus);
  }
}

LRESULT CALLBACK ButtonProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp,
    UINT_PTR id, DWORD_PTR reference) {
  auto* style = reinterpret_cast<ButtonStyle*>(reference);
  switch (message) {
    case WM_PAINT: {
      PAINTSTRUCT paint{};
      HDC dc = BeginPaint(hwnd, &paint);
      Paint(hwnd, dc, *style);
      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_PRINTCLIENT:
      Paint(hwnd, reinterpret_cast<HDC>(wp), *style);
      return 0;
    case WM_ERASEBKGND: return 1;
    case WM_MOUSEMOVE: {
      if (!style->hover) {
        style->hover = true;
        TRACKMOUSEEVENT tracking{sizeof(tracking), TME_LEAVE, hwnd, 0};
        TrackMouseEvent(&tracking);
        InvalidateRect(hwnd, nullptr, FALSE);
      }
      break;
    }
    case WM_MOUSELEAVE:
      style->hover = false;
      InvalidateRect(hwnd, nullptr, FALSE);
      break;
    case WM_NCDESTROY:
      RemoveWindowSubclass(hwnd, ButtonProc, id);
      delete style;
      return DefSubclassProc(hwnd, message, wp, lp);
    case WM_SETFOCUS: case WM_KILLFOCUS: case WM_ENABLE: case WM_SETTEXT:
    case BM_SETSTATE: case BM_SETSTYLE: case WM_UPDATEUISTATE:
    case WM_KEYDOWN: case WM_KEYUP: case WM_LBUTTONDOWN: case WM_LBUTTONUP: {
      const LRESULT result = DefSubclassProc(hwnd, message, wp, lp);
      InvalidateRect(hwnd, nullptr, FALSE);
      return result;
    }
  }
  return DefSubclassProc(hwnd, message, wp, lp);
}

void Style(HWND button, bool primary) {
  if (!IsWindow(button)) return;
  HIGHCONTRASTW contrast{sizeof(contrast), 0, nullptr};
  if (SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(contrast), &contrast, 0)
      && (contrast.dwFlags & HCF_HIGHCONTRASTON)) return;
  DWORD_PTR previous = 0;
  if (GetWindowSubclass(button, ButtonProc, kSubclass, &previous)) {
    reinterpret_cast<ButtonStyle*>(previous)->primary = primary;
  } else {
    auto* style = new(std::nothrow) ButtonStyle{primary};
    if (!style) return;
    if (!SetWindowSubclass(button, ButtonProc, kSubclass, reinterpret_cast<DWORD_PTR>(style))) {
      delete style;
      return;
    }
  }
  InvalidateRect(button, nullptr, FALSE);
}

LRESULT CALLBACK EditProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp,
    UINT_PTR id, DWORD_PTR reference) {
  if (message == WM_NCDESTROY) RemoveWindowSubclass(hwnd, EditProc, id);
  const LRESULT result = DefSubclassProc(hwnd, message, wp, lp);
  if (message == WM_SETFOCUS || message == WM_KILLFOCUS || message == WM_ENABLE)
    InvalidateRect(reinterpret_cast<HWND>(reference), nullptr, FALSE);
  return result;
}

void FramedEdit(HWND page, HWND edit, int x, int y, int width, int height) {
  HIGHCONTRASTW contrast{sizeof(contrast), 0, nullptr};
  if (SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(contrast), &contrast, 0)
      && (contrast.dwFlags & HCF_HIGHCONTRASTON)) return;
  HWND frame = Canvas(page, 1906, 6, x, y, width, height);
  SetPropW(frame, L"ShotEdit", edit);
  SetWindowSubclass(edit, EditProc, kSubclass, reinterpret_cast<DWORD_PTR>(frame));
  SetWindowLongPtrW(edit, GWL_STYLE, GetWindowLongPtrW(edit, GWL_STYLE) & ~WS_BORDER);
  SetWindowLongPtrW(edit, GWL_EXSTYLE, GetWindowLongPtrW(edit, GWL_EXSTYLE) & ~WS_EX_CLIENTEDGE);
  SetWindowPos(edit, nullptr, 0, 0, 0, 0,
    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  Move(edit, x + 13, y + 9, width - 26, height - 18);
  SendMessageW(edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, 0);
}
} // namespace

extern "C" void __cdecl Navigation(HWND parent, int, wchar_t*, Stack**, void*) {
  // Keep decoration behind native controls added later by nsDialogs.
  for (HWND child = GetWindow(parent, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
    HWND header = GetDlgItem(child, 1900);
    if (header) SetWindowPos(header, HWND_BOTTOM, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  }
  RECT client{};
  GetClientRect(parent, &client);
  const int y = client.bottom - Px(50);
  const int ids[]{3, 2, 1}; // back, cancel, next
  const int positions[]{40, 416, 552};
  const int widths[]{104, 124, 148};
  for (int i = 0; i < 3; ++i) {
    HWND button = GetDlgItem(parent, ids[i]);
    SetWindowPos(button, HWND_TOP, Px(positions[i]), y, Px(widths[i]), Px(36),
      SWP_NOACTIVATE);
    SendMessageW(button, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
    Style(button, ids[i] == 1);
  }
}

extern "C" void __cdecl Shell(HWND parent, int, wchar_t*, Stack**, void*) {
  gDpi = static_cast<int>(GetDpiForWindow(parent));
  if (!gDpi) gDpi = 96;
#ifdef SHOT_UI_PREVIEW
  // Layout QA without changing the user's Windows display settings.
  wchar_t previewDpi[16]{};
  if (GetEnvironmentVariableW(L"SHOT_PREVIEW_DPI", previewDpi, 16)) {
    const int dpi = _wtoi(previewDpi);
    if (dpi >= 96 && dpi <= 192) gDpi = dpi;
  }
#endif
  if (!gBody) {
    gBody = Font(14, FW_NORMAL);
    gTitle = Font(28, FW_SEMIBOLD);
    gLabel = Font(15, FW_SEMIBOLD);
    gSmall = Font(12, FW_NORMAL);
    gBrand = Font(18, FW_SEMIBOLD);
  }
  RECT window{0, 0, Px(740), Px(500)};
  const DWORD style = static_cast<DWORD>(GetWindowLongPtrW(parent, GWL_STYLE));
  const DWORD exStyle = static_cast<DWORD>(GetWindowLongPtrW(parent, GWL_EXSTYLE));
  AdjustWindowRectExForDpi(&window, style, FALSE, exStyle, static_cast<UINT>(gDpi));
  const int width = window.right - window.left, height = window.bottom - window.top;
  MONITORINFO monitor{sizeof(monitor), {}, {}, 0};
  GetMonitorInfoW(MonitorFromWindow(parent, MONITOR_DEFAULTTONEAREST), &monitor);
  const int x = monitor.rcWork.left + (monitor.rcWork.right - monitor.rcWork.left - width) / 2;
  const int y = monitor.rcWork.top + (monitor.rcWork.bottom - monitor.rcWork.top - height) / 2;
  SetWindowPos(parent, nullptr, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
  Navigation(parent, 0, nullptr, nullptr, nullptr);
}

extern "C" void __cdecl MoveControl(HWND, int, wchar_t*, Stack** top, void*) {
  wchar_t values[6][64]{};
  for (auto& value : values) if (!Pop(top, value, 64)) return;
  const auto handle = static_cast<UINT_PTR>(std::wcstoull(values[0], nullptr, 10));
  HWND control = reinterpret_cast<HWND>(handle);
  Move(control, _wtoi(values[1]), _wtoi(values[2]), _wtoi(values[3]), _wtoi(values[4]));
  HFONT font = lstrcmpW(values[5], L"title") == 0 ? gTitle
    : lstrcmpW(values[5], L"label") == 0 ? gLabel
    : lstrcmpW(values[5], L"small") == 0 ? gSmall
    : gBody;
  SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font), FALSE);
}

extern "C" void __cdecl Page(HWND parent, int, wchar_t*, Stack** top, void*) {
  // inner, kind, title, description, eyebrow, field-label, browse, note, version
  wchar_t values[9][2048]{};
  for (auto& value : values) if (!Pop(top, value, 2048)) return;
  HWND inner = reinterpret_cast<HWND>(static_cast<UINT_PTR>(std::wcstoull(values[0], nullptr, 10)));
  if (!IsWindow(inner)) return;
  Surface(parent, inner);
  SetWindowTextW(GetDlgItem(inner, 1900), values[8]);
  const bool directory = lstrcmpW(values[1], L"directory") == 0;
  const bool progress = lstrcmpW(values[1], L"progress") == 0;
  const bool confirm = lstrcmpW(values[1], L"confirm") == 0;
  const bool maintenance = lstrcmpW(values[1], L"maintenance") == 0;
  const bool license = lstrcmpW(values[1], L"license") == 0;
  if (lstrcmpW(values[1], L"welcome") == 0) {
    for (int i = 0; i < 3; ++i) Canvas(inner, 1910 + i, 3 + i, kLeft, 244 + 62 * i, 40, 40);
  } else if (lstrcmpW(values[1], L"finish") == 0) {
    Canvas(inner, 1910, 2, kLeft, 244, kContent, 112);
  }
  if (maintenance) {
    int radioY = 288;
    for (HWND control = GetWindow(inner, GW_CHILD); control; control = GetWindow(control, GW_HWNDNEXT)) {
      if (GetDlgCtrlID(control) == 1900) continue;
      wchar_t kind[40]{};
      GetClassNameW(control, kind, 40);
      if (lstrcmpW(kind, L"Button") == 0) {
        SetWindowLongPtrW(control, GWL_STYLE, GetWindowLongPtrW(control, GWL_STYLE) | BS_MULTILINE);
        Move(control, kLeft, radioY, kContent, 40);
        radioY += 56;
      } else {
        Move(control, kLeft, 180, kContent, 88);
      }
      SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
    }
    Heading(inner, values[2], L"", values[4]);
  }
  if (directory || progress || confirm || license) {
    Heading(inner, values[2], values[3], values[4]);
    if (license) {
      ShowWindow(GetDlgItem(inner, 1040), SW_HIDE);
      HWND document = GetDlgItem(inner, 1000);
      Move(document, kLeft, 232, kContent, 140);
      SendMessageW(document, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
      FramedEdit(inner, document, kLeft, 232, kContent, 140);
      CHARFORMATW format{};
      format.cbSize = sizeof(format);
      format.dwMask = CFM_FACE | CFM_SIZE | CFM_COLOR;
      const UINT documentDpi = GetDpiForWindow(document);
      format.yHeight = MulDiv(210, gDpi, documentDpi ? static_cast<int>(documentDpi) : 96);
      format.crTextColor = kInk;
      lstrcpynW(format.szFaceName, L"Segoe UI", LF_FACESIZE);
      SendMessageW(document, EM_SETCHARFORMAT, SCF_ALL, reinterpret_cast<LPARAM>(&format));
      SendMessageW(document, EM_SETBKGNDCOLOR, 0, kPaper);
      HWND notice = GetDlgItem(inner, 1006);
      SetWindowTextW(notice, values[7]);
      Move(notice, kLeft, 390, kContent, 26);
      SendMessageW(notice, WM_SETFONT, reinterpret_cast<WPARAM>(gSmall), FALSE);
    } else if (directory) {
      for (const int id : {1006, 1020}) ShowWindow(GetDlgItem(inner, id), SW_HIDE);
      Label(inner, 1904, values[5], kLeft, 240, kContent, 22, gLabel);
      HWND edit = GetDlgItem(inner, 1019), browse = GetDlgItem(inner, 1001);
      Move(edit, kLeft, 272, 534, 30);
      SendMessageW(edit, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
      SendMessageW(edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELPARAM(Px(10), Px(10)));
      FramedEdit(inner, edit, kLeft, 268, 534, 40);
      Move(browse, 586, 268, 114, 38);
      SetWindowTextW(browse, values[6]);
      SendMessageW(browse, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
      Style(browse, false);
      Label(inner, 1905, values[7], kLeft, 324, kContent, 44, gBody);
      for (int i = 0; i < 2; ++i) {
        HWND space = GetDlgItem(inner, 1023 + i);
        Move(space, kLeft + i * 336, 386, 324, 20);
        SendMessageW(space, WM_SETFONT, reinterpret_cast<WPARAM>(gSmall), FALSE);
      }
    } else if (progress) {
      Move(GetDlgItem(inner, 1006), kLeft, 240, kContent, 22);
      SendMessageW(GetDlgItem(inner, 1006), WM_SETFONT, reinterpret_cast<WPARAM>(gSmall), FALSE);
      Move(GetDlgItem(inner, 1004), kLeft, 276, kContent, 8);
      HWND bar = GetDlgItem(inner, 1004);
      SetWindowTheme(bar, L"", L"");
      SendMessageW(bar, PBM_SETBARCOLOR, 0, kYellow);
      SendMessageW(bar, PBM_SETBKCOLOR, 0, RGB(238, 240, 243));
      SetWindowLongPtrW(bar, GWL_EXSTYLE, GetWindowLongPtrW(bar, GWL_EXSTYLE) & ~WS_EX_CLIENTEDGE);
      HWND details = GetDlgItem(inner, 1027);
      Move(details, kLeft, 306, 220, 30);
      SetWindowTextW(details, values[6]);
      SendMessageW(details, WM_SETFONT, reinterpret_cast<WPARAM>(gSmall), FALSE);
      Style(details, false);
      Move(GetDlgItem(inner, 1016), kLeft, 348, kContent, 70);
    } else {
      for (const int id : {1006, 1029, 1000}) ShowWindow(GetDlgItem(inner, id), SW_HIDE);
      Move(GetDlgItem(inner, 1903), kLeft, 180, kContent, 100);
    }
  }
  Navigation(parent, 0, nullptr, nullptr, nullptr);
  RedrawWindow(inner, nullptr, nullptr, RDW_INVALIDATE | RDW_ALLCHILDREN);
}

#ifdef SHOT_UI_PREVIEW
#include "../../../dev/installer-ui-test.cpp"
#endif
