// Compiled only with -Preview. Never included in the shipping UI DLL.
#include <vector>

namespace {
struct PreviewCapture { wchar_t path[2048]; int advance; };

BOOL CALLBACK DumpControl(HWND hwnd, LPARAM parameter) {
  auto* file = reinterpret_cast<FILE*>(parameter);
  wchar_t text[2048]{}, kind[80]{};
  GetWindowTextW(hwnd, text, 2048);
  GetClassNameW(hwnd, kind, 80);
  RECT rect{};
  GetWindowRect(hwnd, &rect);
  const HWND root = GetAncestor(hwnd, GA_ROOT);
  MapWindowPoints(nullptr, root, reinterpret_cast<POINT*>(&rect), 2);
  fwprintf(file, L"id=%d visible=%d class=%s rect=%ld,%ld,%ld,%ld text=[%s]\n",
    GetDlgCtrlID(hwnd), IsWindowVisible(hwnd), kind, rect.left, rect.top, rect.right, rect.bottom, text);
  return TRUE;
}

void PaintChildren(HWND parent, HWND root, HDC dc) {
  HWND first = GetWindow(parent, GW_CHILD);
  if (!first) return;
  for (HWND child = GetWindow(first, GW_HWNDLAST); child; child = GetWindow(child, GW_HWNDPREV)) {
    if (!IsWindowVisible(child)) continue;
    RECT rect{};
    GetWindowRect(child, &rect);
    RECT rootRect{};
    GetWindowRect(root, &rootRect);
    const int state = SaveDC(dc);
    SetViewportOrgEx(dc, rect.left - rootRect.left, rect.top - rootRect.top, nullptr);
    IntersectClipRect(dc, 0, 0, rect.right - rect.left, rect.bottom - rect.top);
    SendMessageW(child, WM_PRINT, reinterpret_cast<WPARAM>(dc), PRF_NONCLIENT | PRF_CLIENT | PRF_ERASEBKGND);
    RestoreDC(dc, state);
    PaintChildren(child, root, dc);
  }
}

void CALLBACK CaptureTimer(HWND parent, UINT, UINT_PTR timer, DWORD) {
  KillTimer(parent, timer);
  auto* capture = reinterpret_cast<PreviewCapture*>(GetPropW(parent, L"ShotPreview"));
  RemovePropW(parent, L"ShotPreview");
  if (!capture) return;
  ShowWindow(parent, SW_SHOWNOACTIVATE);
  RedrawWindow(parent, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN);
  RECT rect{};
  GetWindowRect(parent, &rect);
  const int width = rect.right - rect.left, height = rect.bottom - rect.top;
  HDC dc = GetWindowDC(parent);
  HDC memory = CreateCompatibleDC(dc);
  HBITMAP bitmap = CreateCompatibleBitmap(dc, width, height);
  const HGDIOBJ previous = SelectObject(memory, bitmap);
  PrintWindow(parent, memory, 0);
  PaintChildren(parent, parent, memory);
  SelectObject(memory, previous);
  BITMAPINFO info{};
  info.bmiHeader = {sizeof(BITMAPINFOHEADER), width, height, 1, 32, BI_RGB, 0, 0, 0, 0, 0};
  std::vector<BYTE> pixels(static_cast<size_t>(width) * height * 4);
  GetDIBits(dc, bitmap, 0, static_cast<UINT>(height), pixels.data(), &info, DIB_RGB_COLORS);
  BITMAPFILEHEADER header{};
  header.bfType = 0x4d42;
  header.bfOffBits = sizeof(header) + sizeof(info.bmiHeader);
  header.bfSize = header.bfOffBits + static_cast<DWORD>(pixels.size());
  HANDLE file = CreateFileW(capture->path, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  DWORD written = 0;
  if (file != INVALID_HANDLE_VALUE) {
    WriteFile(file, &header, sizeof(header), &written, nullptr);
    WriteFile(file, &info.bmiHeader, sizeof(info.bmiHeader), &written, nullptr);
    WriteFile(file, pixels.data(), static_cast<DWORD>(pixels.size()), &written, nullptr);
    CloseHandle(file);
  }
  wchar_t logPath[2100]{};
  swprintf_s(logPath, L"%s.txt", capture->path);
  FILE* log = nullptr;
  _wfopen_s(&log, logPath, L"w, ccs=UTF-8");
  if (log) {
    EnumChildWindows(parent, DumpControl, reinterpret_cast<LPARAM>(log));
    fclose(log);
  }
  DeleteObject(bitmap);
  DeleteDC(memory);
  ReleaseDC(parent, dc);
  const int advance = capture->advance;
  delete capture;
  if (advance == 1 || advance == 2) {
    SetActiveWindow(parent);
    PostMessageW(GetDlgItem(parent, 1), BM_CLICK, 0, 0);
  }
}
} // namespace

extern "C" __declspec(dllexport) void __cdecl TestPage(HWND parent, int, wchar_t*, Stack** stack, void*) {
  auto* capture = new PreviewCapture{};
  wchar_t advance[16]{};
  if (!Pop(stack, capture->path, 2048) || !Pop(stack, advance, 16)) { delete capture; return; }
  capture->advance = _wtoi(advance);
  SetPropW(parent, L"ShotPreview", capture);
  SetTimer(parent, 0x53484f54, 600, CaptureTimer);
}
