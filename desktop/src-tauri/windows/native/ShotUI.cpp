// AlgorithShot's NSIS button renderer. These remain standard Win32 Buttons:
// keyboard navigation, accelerators, UI Automation and click handling stay native.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <cstdlib>
#include <cwchar>
#include <cstdio>
#include <initializer_list>
#include <new>

namespace {
constexpr UINT_PTR kSubclass = 0x53484f54;
constexpr COLORREF kPaper = RGB(247, 247, 245);
constexpr COLORREF kInk = RGB(17, 17, 17);
constexpr COLORREF kYellow = RGB(255, 211, 0);
constexpr int kRail = 240;
constexpr int kLeft = 280;
constexpr int kContent = 480;
constexpr int kFooter = 64;
HFONT gBody = nullptr, gTitle = nullptr, gLabel = nullptr, gSmall = nullptr, gMono = nullptr;
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
void Mark(HDC dc, int x, int y, int size) {
  const int inset = size / 4, edge = size / 5, thick = max(2, size / 14);
  for (int i = 0; i < 4; ++i) {
    const int cx = x + (i & 1 ? size - inset : inset);
    const int cy = y + (i & 2 ? size - inset : inset);
    Line(dc, cx, cy, cx + (i & 1 ? -edge : edge), cy, RGB(255, 255, 255), thick);
    Line(dc, cx, cy, cx, cy + (i & 2 ? -edge : edge), RGB(255, 255, 255), thick);
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
LRESULT CALLBACK RailProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp,
    UINT_PTR id, DWORD_PTR) {
  if (message == WM_PAINT || message == WM_PRINTCLIENT) {
    PAINTSTRUCT paint{};
    HDC dc = message == WM_PAINT ? BeginPaint(hwnd, &paint) : reinterpret_cast<HDC>(wp);
    RECT rect{};
    GetClientRect(hwnd, &rect);
    HBRUSH brush = CreateSolidBrush(kInk);
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
    const int h = MulDiv(rect.bottom, 96, gDpi);
    Mark(dc, 23, 24, 40);
    Text(dc, L"AlgorithShot", 70, 29, 155, 25, gLabel, RGB(247, 247, 245));
    Text(dc, L"BY ALGORITHCO", 71, 54, 145, 20, gSmall, RGB(139, 139, 132));
    const int cy = h / 2 - 28;
    for (int x = 29; x < kRail - 20; x += 20)
      for (int y = cy - 80; y < cy + 100; y += 20)
        SetPixelV(dc, Px(x), Px(y), RGB(55, 55, 50));
    for (int i = 0; i < 4; ++i) {
      const int x = i & 1 ? 210 : 30, y = cy + (i & 2 ? 80 : -70);
      Line(dc, x, y, x + (i & 1 ? -21 : 21), y, kYellow, 2);
      Line(dc, x, y, x, y + (i & 2 ? -21 : 21), kYellow, 2);
    }
    Mark(dc, 60, cy - 55, 120);
    Line(dc, 28, h - 73, 212, h - 73, RGB(49, 49, 47));
    wchar_t version[80]{};
    GetWindowTextW(hwnd, version, 80);
    Text(dc, version, 28, h - 53, 150, 24, gMono, RGB(170, 169, 162));
    if (message == WM_PAINT) EndPaint(hwnd, &paint);
    return 0;
  }
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_NCDESTROY) RemoveWindowSubclass(hwnd, RailProc, id);
  return DefSubclassProc(hwnd, message, wp, lp);
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
  HWND rail = GetDlgItem(parent, 1900);
  if (!rail) {
    rail = CreateWindowExW(0, L"Static", L"", WS_CHILD | WS_VISIBLE,
      0, 0, 0, 0, parent, reinterpret_cast<HMENU>(1900), nullptr, nullptr);
    SetWindowSubclass(rail, RailProc, kSubclass, 0);
  }
  SetWindowPos(rail, HWND_TOP, 0, 0, Px(kRail), client.bottom, SWP_NOACTIVATE);
}

void Heading(HWND page, const wchar_t* title, const wchar_t* description, const wchar_t* eyebrow) {
  Label(page, 1901, eyebrow, kLeft, 30, kContent, 20, gSmall);
  Label(page, 1902, title, kLeft, 66, kContent, 70, gTitle);
  Label(page, 1903, description, kLeft, 145, kContent, 62, gBody);
}

void Paint(HWND button, HDC dc, const ButtonStyle& style) {
  RECT bounds{};
  GetClientRect(button, &bounds);
  HBRUSH background = CreateSolidBrush(kPaper);
  FillRect(dc, &bounds, background);
  DeleteObject(background);
  const bool enabled = IsWindowEnabled(button) != FALSE;
  const bool pressed = (SendMessageW(button, BM_GETSTATE, 0, 0) & BST_PUSHED) != 0;
  const COLORREF fill = !enabled ? RGB(239, 239, 235) : style.primary
    ? (pressed ? RGB(242, 195, 0) : style.hover ? RGB(255, 194, 41) : RGB(255, 211, 0))
    : (style.hover || pressed ? RGB(239, 239, 235) : RGB(255, 255, 255));
  HBRUSH brush = CreateSolidBrush(fill);
  HPEN pen = CreatePen(PS_SOLID, 1, style.primary ? fill : RGB(217, 217, 211));
  const HGDIOBJ oldBrush = SelectObject(dc, brush);
  const HGDIOBJ oldPen = SelectObject(dc, pen);
  RECT units{0, 0, 4, 4};
  MapDialogRect(GetParent(button), &units);
  RoundRect(dc, 0, 0, bounds.right, bounds.bottom, units.right * 2, units.bottom);
  SelectObject(dc, oldBrush);
  SelectObject(dc, oldPen);
  DeleteObject(brush);
  DeleteObject(pen);

  wchar_t text[256]{};
  GetWindowTextW(button, text, 256);
  HFONT font = reinterpret_cast<HFONT>(SendMessageW(button, WM_GETFONT, 0, 0));
  const HGDIOBJ oldFont = SelectObject(dc, font ? font : GetStockObject(DEFAULT_GUI_FONT));
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, enabled ? kInk : RGB(139, 139, 132));
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
} // namespace

extern "C" void __cdecl Navigation(HWND parent, int, wchar_t*, Stack**, void*) {
  RECT client{};
  GetClientRect(parent, &client);
  const int y = client.bottom - Px(48);
  const int ids[]{3, 2, 1}; // back, cancel, next
  const int positions[]{280, 508, 640};
  const int widths[]{100, 120, 120};
  for (int i = 0; i < 3; ++i) {
    HWND button = GetDlgItem(parent, ids[i]);
    SetWindowPos(button, nullptr, Px(positions[i]), y, Px(widths[i]), Px(34),
      SWP_NOZORDER | SWP_NOACTIVATE);
    SendMessageW(button, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
    Style(button, ids[i] == 1);
  }
}

extern "C" void __cdecl Shell(HWND parent, int, wchar_t*, Stack**, void*) {
  gDpi = static_cast<int>(GetDpiForWindow(parent));
  if (!gDpi) gDpi = 96;
  if (!gBody) {
    gBody = Font(14, FW_NORMAL);
    gTitle = Font(28, FW_BOLD);
    gLabel = Font(16, FW_SEMIBOLD);
    gSmall = Font(12, FW_NORMAL);
    gMono = Font(12, FW_NORMAL, L"Consolas");
  }
  RECT window{0, 0, Px(800), Px(510)};
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
    : lstrcmpW(values[5], L"mono") == 0 ? gMono : gBody;
  SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font), FALSE);
}

extern "C" void __cdecl Page(HWND parent, int, wchar_t*, Stack** top, void*) {
  // inner, kind, title, description, eyebrow, field-label, browse, note, version
  wchar_t values[9][2048]{};
  for (auto& value : values) if (!Pop(top, value, 2048)) return;
  HWND inner = reinterpret_cast<HWND>(static_cast<UINT_PTR>(std::wcstoull(values[0], nullptr, 10)));
  Surface(parent, inner);
  SetWindowTextW(GetDlgItem(parent, 1900), values[8]);
  const bool directory = lstrcmpW(values[1], L"directory") == 0;
  const bool progress = lstrcmpW(values[1], L"progress") == 0;
  const bool confirm = lstrcmpW(values[1], L"confirm") == 0;
  const bool maintenance = lstrcmpW(values[1], L"maintenance") == 0;
  if (maintenance) {
    int radioY = 262;
    for (HWND control = GetWindow(inner, GW_CHILD); control; control = GetWindow(control, GW_HWNDNEXT)) {
      if (GetDlgCtrlID(control) == 1900) continue;
      wchar_t kind[40]{};
      GetClassNameW(control, kind, 40);
      if (lstrcmpW(kind, L"Button") == 0) {
        SetWindowLongPtrW(control, GWL_STYLE, GetWindowLongPtrW(control, GWL_STYLE) | BS_MULTILINE);
        Move(control, kLeft, radioY, kContent, 40);
        radioY += 56;
      } else {
        Move(control, kLeft, 145, kContent, 95);
      }
      SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
    }
    Heading(inner, values[2], L"", values[4]);
  }
  if (directory || progress || confirm) {
    Heading(inner, values[2], values[3], values[4]);
    if (directory) {
      for (const int id : {1006, 1020, 1023, 1024}) ShowWindow(GetDlgItem(inner, id), SW_HIDE);
      Label(inner, 1904, values[5], kLeft, 228, kContent, 22, gLabel);
      HWND edit = GetDlgItem(inner, 1019), browse = GetDlgItem(inner, 1001);
      Move(edit, kLeft, 260, 354, 36);
      SendMessageW(edit, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
      SendMessageW(edit, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELPARAM(Px(10), Px(10)));
      Move(browse, 646, 260, 114, 36);
      SetWindowTextW(browse, values[6]);
      SendMessageW(browse, WM_SETFONT, reinterpret_cast<WPARAM>(gBody), FALSE);
      Style(browse, false);
      Label(inner, 1905, values[7], kLeft, 315, kContent, 56, gSmall);
    } else if (progress) {
      Move(GetDlgItem(inner, 1006), kLeft, 223, kContent, 22);
      Move(GetDlgItem(inner, 1004), kLeft, 257, kContent, 8);
      HWND bar = GetDlgItem(inner, 1004);
      SetWindowTheme(bar, L"", L"");
      SendMessageW(bar, PBM_SETBARCOLOR, 0, kYellow);
      SendMessageW(bar, PBM_SETBKCOLOR, 0, RGB(239, 239, 235));
      SetWindowLongPtrW(bar, GWL_EXSTYLE, GetWindowLongPtrW(bar, GWL_EXSTYLE) & ~WS_EX_CLIENTEDGE);
      HWND details = GetDlgItem(inner, 1027);
      Move(details, kLeft, 286, 170, 30);
      SetWindowTextW(details, values[6]);
      SendMessageW(details, WM_SETFONT, reinterpret_cast<WPARAM>(gSmall), FALSE);
      Style(details, false);
      Move(GetDlgItem(inner, 1016), kLeft, 329, kContent, 100);
    } else {
      for (const int id : {1006, 1029, 1000}) ShowWindow(GetDlgItem(inner, id), SW_HIDE);
      Move(GetDlgItem(inner, 1903), kLeft, 145, kContent, 130);
    }
  }
  Navigation(parent, 0, nullptr, nullptr, nullptr);
  RedrawWindow(inner, nullptr, nullptr, RDW_INVALIDATE | RDW_ALLCHILDREN);
}

#ifdef SHOT_UI_PREVIEW
#include "../../../dev/installer-ui-test.cpp"
#endif
