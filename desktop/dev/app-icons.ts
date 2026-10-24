// Offline artwork for the fake apps in the browser preview. The desktop app
// always serves the actual icons extracted from Windows by app_icons.rs.
const artwork: Record<string, string> = {
  Telegram: '<circle cx="12" cy="12" r="12" fill="#28a8e9"/><path d="m5.1 11.6 13-5c.6-.2 1 .2.8 1l-2.2 10.3c-.1.7-.6.9-1.2.5l-3.3-2.5-1.6 1.6c-.2.2-.4.3-.6.3l.2-3.4 6.2-5.6c.3-.2-.1-.4-.4-.2l-7.7 4.8L5 12.3c-.7-.2-.7-.5.1-.7Z" fill="#fff"/>',
  Chrome: '<circle cx="12" cy="12" r="12" fill="#fff"/><path d="M12 0a12 12 0 0 1 10.4 6H12a6 6 0 0 0-5.2 9L1.6 6A12 12 0 0 1 12 0" fill="#ea4335"/><path d="M22.4 6a12 12 0 0 1-10.4 18l5.2-9A6 6 0 0 0 12 6" fill="#fbbc05"/><path d="M12 24A12 12 0 0 1 1.6 6l5.2 9a6 6 0 0 0 10.4 0" fill="#34a853"/><circle cx="12" cy="12" r="5" fill="#4285f4" stroke="#fff" stroke-width=".8"/>',
  Edge: '<defs><linearGradient id="edge-a" x2="0" y2="1"><stop stop-color="#087cdc"/><stop offset="1" stop-color="#0546a8"/></linearGradient><linearGradient id="edge-b" x2="1" y2="1"><stop stop-color="#35c4ec"/><stop offset="1" stop-color="#18bb86"/></linearGradient></defs><path d="M23 16c-1.8 5.3-8.4 8.1-14.1 6C2.5 19.7 2.3 11 8.7 8c-2.2 4.5.9 8.6 5.7 8.9 3 .3 5.7-.2 8.6-.9Z" fill="url(#edge-a)"/><path d="M1 14C-.7 6 5.7-.4 13.2.3 19 .8 23.6 5.4 23.8 11c.1 4.8-4.2 6.7-8.9 5.6 4.5-2.7 3.1-8.3-1.6-8.9C7.8 7 3.2 9.2 1 14Z" fill="url(#edge-b)"/>',
  "VS Code": '<path d="m17.3 1 5.8 2.8v16.4L17.3 23 6.7 13.5l-4.2 3.2L.9 16V8l1.6-.7 4.2 3.2L17.3 1Zm0 6.3-6.2 4.7 6.2 4.7V7.3ZM2.5 9.4v5.2L5 12 2.5 9.4Z" fill="#23a9f2"/>',
  Excel: '<rect x="8" y="2" width="15" height="20" rx="1.5" fill="#107c41"/><path d="M8 2h15v7H8z" fill="#33c481"/><path d="M8 9h15v7H8z" fill="#21a366"/><path d="M16 2v20M8 9h15M8 16h15" stroke="#fff" stroke-opacity=".25"/><rect x="1" y="6" width="13" height="13" rx="1" fill="#185c37"/><path d="m5 9 5 7m0-7-5 7" fill="none" stroke="#fff" stroke-width="1.7"/>',
  Explorer: '<path d="M1 5a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v12H1Z" fill="#e7a915"/><path d="M1 8h22v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1Z" fill="#ffcf4e"/><path d="M1 8h22v3H1z" fill="#ffe395"/>',
  Figma: '<path d="M8 0a4 4 0 0 0 0 8h4V0Z" fill="#f24e1e"/><path d="M12 0h4a4 4 0 0 1 0 8h-4Z" fill="#ff7262"/><path d="M8 8a4 4 0 0 0 0 8h4V8Z" fill="#a259ff"/><circle cx="16" cy="12" r="4" fill="#1abcfe"/><path d="M8 16a4 4 0 1 0 4 4v-4Z" fill="#0acf83"/>',
  Claude: '<path d="m12 1 .9 7.6 5-5.8-2.8 7.1 7.4-2-6.3 4.3 6.8 3.5-7.6-1.1 3.8 6.7-5.7-5.1.1 7.7-2.7-7.2-3.6 6.8 1.1-7.6-6.7 3.8 5.1-5.7-7.7.1 7.2-2.7-6.8-3.6 7.6 1.1-3.8-6.7 5.7 5.1Z" fill="#d97757"/>',
  Desktop: '<rect x="1" y="2" width="22" height="16" rx="2" fill="#63768b"/><path d="M3 4h18v12H3z" fill="#36a4e8"/><path d="M10 18h4v3h5v2H5v-2h5z" fill="#92a4b5"/>',
};

export function previewAppIcon(name: string): string {
  const body = artwork[name] ?? '<rect x="2" y="3" width="20" height="18" rx="3" fill="none" stroke="#89939d" stroke-width="2"/><path d="M2 8h20" stroke="#89939d" stroke-width="2"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">${body}</svg>`;
}
