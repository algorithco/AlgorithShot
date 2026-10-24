//! The few texts made in Rust (tray menu). The UI's texts live in src/i18n.

pub fn t(lang: &str, key: &str) -> &'static str {
    let row: [&'static str; 3] = match key {
        "capture" => ["Take screenshot", "Skrinshot olish", "Сделать скриншот"],
        "text" => ["Copy text from screen", "Ekrandagi matnni nusxalash", "Скопировать текст с экрана"],
        "qr" => ["Scan QR code", "QR kodni oʻqish", "Сканировать QR-код"],
        "screen" => ["Full screen", "Butun ekran", "Весь экран"],
        "repeat" => ["Repeat last area", "Oxirgi hududni qayta olish", "Повторить последнюю область"],
        "timer" => ["Capture in 3 seconds", "3 soniyadan keyin olish", "Снимок через 3 секунды"],
        "library" => ["Open library", "Kutubxonani ochish", "Открыть библиотеку"],
        "settings" => ["Settings", "Sozlamalar", "Настройки"],
        "quit" => ["Quit", "Chiqish", "Выход"],
        _ => ["", "", ""],
    };
    match lang {
        "uz" => row[1],
        "ru" => row[2],
        _ => row[0],
    }
}
