//! The screenshot library: a SQLite index over the files in the save folder,
//! with full-text search on the file name, source app, window title, page
//! address and the text read from each screenshot.

use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub struct Library {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub id: String,
    pub path: String,
    pub name: String,
    /// Unix time in milliseconds.
    pub created: i64,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub format: String,
    pub app: String,
    pub title: String,
    pub url: String,
    pub favorite: bool,
    pub edited: bool,
    /// 0 = waiting to be read, 1 = read, 2 = skipped or failed.
    pub text_state: i32,
    /// How many private items were found; -1 = not checked yet.
    pub privacy: i32,
    /// Grows when the file changes, so cached thumbnails refresh.
    pub rev: i64,
}

#[derive(Debug, Clone, Default)]
pub struct NewShot {
    pub path: String,
    pub created: i64,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub format: String,
    pub app: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    pub search: String,
    /// "all", "favorites", "today", "week" or "month".
    pub filter: String,
    pub app: String,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListResult {
    pub items: Vec<Shot>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppCount {
    pub app: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub count: i64,
    pub bytes: i64,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'png',
  app TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  edited INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  text_state INTEGER NOT NULL DEFAULT 0,
  privacy INTEGER NOT NULL DEFAULT -1,
  privacy_json TEXT NOT NULL DEFAULT '',
  phash BLOB,
  rev INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER
);
CREATE INDEX IF NOT EXISTS shots_created ON shots(created DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS shots_fts USING fts5(
  name, app, title, url, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
"#;

const COLUMNS: &str = "id, path, created, width, height, bytes, format, app, title, url, favorite, edited, text_state, privacy, rev";

fn shot_from_row(row: &Row) -> rusqlite::Result<Shot> {
    let path: String = row.get(1)?;
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Shot {
        id: row.get(0)?,
        name,
        path,
        created: row.get(2)?,
        width: row.get(3)?,
        height: row.get(4)?,
        bytes: row.get::<_, i64>(5)? as u64,
        format: row.get(6)?,
        app: row.get(7)?,
        title: row.get(8)?,
        url: row.get(9)?,
        favorite: row.get::<_, i64>(10)? != 0,
        edited: row.get::<_, i64>(11)? != 0,
        text_state: row.get(12)?,
        privacy: row.get(13)?,
        rev: row.get(14)?,
    })
}

impl Library {
    pub fn open(path: &Path) -> Result<Library> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Library { conn: Mutex::new(conn) })
    }

    #[cfg(test)]
    pub fn in_memory() -> Library {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Library { conn: Mutex::new(conn) }
    }

    pub fn insert(&self, s: &NewShot) -> Result<Shot> {
        let id = uuid::Uuid::now_v7().to_string();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO shots (id, path, created, width, height, bytes, format, app, title, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, s.path, s.created, s.width, s.height, s.bytes as i64, s.format, s.app, s.title, s.url],
        )?;
        let rowid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO shots_fts (rowid, name, app, title, url, body) VALUES (?1, ?2, ?3, ?4, ?5, '')",
            params![rowid, search_text(&file_stem(&s.path)), search_text(&s.app), search_text(&s.title), search_text(&s.url)],
        )?;
        drop(conn);
        Ok(self.get(&id)?.expect("row just inserted"))
    }

    pub fn get(&self, id: &str) -> Result<Option<Shot>> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row(&format!("SELECT {COLUMNS} FROM shots WHERE id = ?1"), [id], shot_from_row)
            .optional()?)
    }

    pub fn by_path(&self, path: &str) -> Result<Option<Shot>> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row(&format!("SELECT {COLUMNS} FROM shots WHERE path = ?1"), [path], shot_from_row)
            .optional()?)
    }

    pub fn list(&self, q: &ListQuery) -> Result<ListResult> {
        let mut wheres = vec!["s.trashed_at IS NULL".to_string()];
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        let mut join = String::new();

        if let Some(fts) = fts_query(&q.search) {
            join = "JOIN shots_fts f ON f.rowid = s.rowid".into();
            wheres.push("shots_fts MATCH ?".into());
            args.push(fts.into());
        }
        match q.filter.as_str() {
            "favorites" => wheres.push("s.favorite = 1".into()),
            "today" | "week" | "month" => {
                wheres.push("s.created >= ?".into());
                args.push(since(&q.filter).into());
            }
            _ => {}
        }
        if !q.app.is_empty() {
            wheres.push("s.app = ?".into());
            args.push(q.app.clone().into());
        }

        let where_sql = wheres.join(" AND ");
        let conn = self.conn.lock();
        let total: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM shots s {join} WHERE {where_sql}"),
            params_from_iter(args.iter()),
            |r| r.get(0),
        )?;

        let limit = if q.limit == 0 { 200 } else { q.limit.min(1000) };
        let cols = COLUMNS.split(", ").map(|c| format!("s.{c}")).collect::<Vec<_>>().join(", ");
        let mut stmt = conn.prepare(&format!(
            "SELECT {cols} FROM shots s {join} WHERE {where_sql} ORDER BY s.created DESC LIMIT {limit} OFFSET {}",
            q.offset
        ))?;
        let items = stmt.query_map(params_from_iter(args.iter()), shot_from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ListResult { items, total })
    }

    pub fn apps(&self) -> Result<Vec<AppCount>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT app, COUNT(*) FROM shots WHERE trashed_at IS NULL AND app != '' GROUP BY app ORDER BY COUNT(*) DESC, app",
        )?;
        let rows = stmt.query_map([], |r| Ok(AppCount { app: r.get(0)?, count: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn stats(&self) -> Result<Stats> {
        let conn = self.conn.lock();
        Ok(conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM shots WHERE trashed_at IS NULL",
            [],
            |r| Ok(Stats { count: r.get(0)?, bytes: r.get(1)? }),
        )?)
    }

    pub fn text(&self, id: &str) -> Result<String> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row("SELECT text FROM shots WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .unwrap_or_default())
    }

    pub fn privacy_json(&self, id: &str) -> Result<String> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row("SELECT privacy_json FROM shots WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .unwrap_or_default())
    }

    /// Records the text read from a screenshot and makes it searchable.
    pub fn set_text(&self, id: &str, text: &str, state: i32) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE shots SET text = ?2, text_state = ?3 WHERE id = ?1", params![id, text, state])?;
        conn.execute(
            "UPDATE shots_fts SET body = ?2 WHERE rowid = (SELECT rowid FROM shots WHERE id = ?1)",
            params![id, search_text(text)],
        )?;
        Ok(())
    }

    pub fn set_privacy(&self, id: &str, count: i32, json: &str) -> Result<()> {
        self.conn
            .lock()
            .execute("UPDATE shots SET privacy = ?2, privacy_json = ?3 WHERE id = ?1", params![id, count, json])?;
        Ok(())
    }

    pub fn set_phash(&self, id: &str, hash: &[u8]) -> Result<()> {
        self.conn.lock().execute("UPDATE shots SET phash = ?2 WHERE id = ?1", params![id, hash])?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        self.conn
            .lock()
            .execute("UPDATE shots SET favorite = ?2 WHERE id = ?1", params![id, favorite as i64])?;
        Ok(())
    }

    /// After the file changed on disk (edit, optimize): new size, new rev.
    /// `reindex` asks for the text and privacy check to run again.
    pub fn file_changed(&self, id: &str, bytes: u64, width: u32, height: u32, edited: Option<bool>, reindex: bool) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE shots SET bytes = ?2, width = ?3, height = ?4, rev = rev + 1, edited = COALESCE(?5, edited) WHERE id = ?1",
            params![id, bytes as i64, width, height, edited.map(|e| e as i64)],
        )?;
        if reindex {
            conn.execute("UPDATE shots SET text_state = 0, privacy = -1, phash = NULL WHERE id = ?1", [id])?;
        }
        Ok(())
    }

    pub fn set_path(&self, id: &str, path: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("UPDATE shots SET path = ?2 WHERE id = ?1", params![id, path])?;
        conn.execute(
            "UPDATE shots_fts SET name = ?2 WHERE rowid = (SELECT rowid FROM shots WHERE id = ?1)",
            params![id, search_text(&file_stem(path))],
        )?;
        Ok(())
    }

    pub fn set_trashed(&self, ids: &[String], when: Option<i64>) -> Result<()> {
        let conn = self.conn.lock();
        for id in ids {
            conn.execute("UPDATE shots SET trashed_at = ?2 WHERE id = ?1", params![id, when])?;
        }
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM shots_fts WHERE rowid = (SELECT rowid FROM shots WHERE id = ?1)", [id])?;
        conn.execute("DELETE FROM shots WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Ids of rows moved to the Recycle Bin before `before` (ms).
    pub fn trashed_before(&self, before: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id FROM shots WHERE trashed_at IS NOT NULL AND trashed_at < ?1")?;
        let rows = stmt.query_map([before], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// (id, path) of every row that isn't in the Recycle Bin.
    pub fn all_paths(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id, path FROM shots WHERE trashed_at IS NULL")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Screenshots still waiting for their text to be read, newest first.
    pub fn pending_text(&self, limit: u32) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id FROM shots WHERE trashed_at IS NULL AND text_state = 0 ORDER BY created DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn phashes(&self) -> Result<Vec<(String, Vec<u8>)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id, phash FROM shots WHERE trashed_at IS NULL AND phash IS NOT NULL ORDER BY created")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn missing_phash(&self, limit: u32) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT id FROM shots WHERE trashed_at IS NULL AND phash IS NULL ORDER BY created DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Not starred and created before `before` (ms), oldest first.
    pub fn older_than(&self, before: i64) -> Result<Vec<Shot>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM shots WHERE trashed_at IS NULL AND favorite = 0 AND created < ?1 ORDER BY created"
        ))?;
        let rows = stmt.query_map([before], shot_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn larger_than(&self, bytes: u64) -> Result<Vec<Shot>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM shots WHERE trashed_at IS NULL AND bytes > ?1 ORDER BY bytes DESC"
        ))?;
        let rows = stmt.query_map([bytes as i64], shot_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_many(&self, ids: &[String]) -> Result<Vec<Shot>> {
        let mut out = Vec::new();
        for id in ids {
            if let Some(s) = self.get(id)? {
                out.push(s);
            }
        }
        Ok(out)
    }
}

fn file_stem(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn since(filter: &str) -> i64 {
    use chrono::{Duration, Local, TimeZone};
    let now = Local::now();
    let start = match filter {
        "today" => now.date_naive().and_hms_opt(0, 0, 0).and_then(|t| Local.from_local_datetime(&t).single()).unwrap_or(now),
        "week" => now - Duration::days(7),
        _ => now - Duration::days(30),
    };
    start.timestamp_millis()
}

/// Text as it's stored for search: lower case, Uzbek apostrophes (oʻ, o‘,
/// o') dropped so they all match, and Cyrillic also written in Latin so
/// "Toshkent" finds "Тошкент".
pub fn search_text(text: &str) -> String {
    let norm = normalize(text);
    if norm.chars().any(is_cyrillic) {
        let latin = transliterate(&norm);
        format!("{norm} {latin}")
    } else {
        norm
    }
}

fn normalize(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '\'' | 'ʻ' | 'ʼ' | '‘' | '’' | '`' | '´'))
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_cyrillic(c: char) -> bool {
    matches!(c, '\u{0400}'..='\u{04FF}')
}

/// Uzbek Cyrillic → Latin (apostrophes already dropped, as in `normalize`).
fn transliterate(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let s = match c {
            'а' => "a", 'б' => "b", 'в' => "v", 'г' => "g", 'д' => "d", 'е' => "e", 'ё' => "yo",
            'ж' => "j", 'з' => "z", 'и' => "i", 'й' => "y", 'к' => "k", 'л' => "l", 'м' => "m",
            'н' => "n", 'о' => "o", 'п' => "p", 'р' => "r", 'с' => "s", 'т' => "t", 'у' => "u",
            'ф' => "f", 'х' => "x", 'ц' => "ts", 'ч' => "ch", 'ш' => "sh", 'щ' => "sh", 'ъ' => "",
            'ы' => "i", 'ь' => "", 'э' => "e", 'ю' => "yu", 'я' => "ya", 'ў' => "o", 'қ' => "q",
            'ғ' => "g", 'ҳ' => "h",
            other => {
                out.push(other);
                continue;
            }
        };
        out.push_str(s);
    }
    out
}

/// Turns what the user typed into an FTS5 query: every word must match as
/// a prefix. Returns None for an empty search.
pub fn fts_query(search: &str) -> Option<String> {
    let terms: Vec<String> = normalize(search)
        .split(|c: char| !c.is_alphanumeric() && c != '@' && c != '+')
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(lib: &Library, path: &str, app: &str, created: i64) -> Shot {
        lib.insert(&NewShot { path: path.into(), created, width: 10, height: 10, bytes: 100, format: "png".into(), app: app.into(), ..Default::default() })
            .unwrap()
    }

    #[test]
    fn search_finds_text_titles_and_both_scripts() {
        let lib = Library::in_memory();
        let a = add(&lib, r"C:\s\Telegram 1.png", "Telegram", 1);
        let b = add(&lib, r"C:\s\Chrome 2.png", "Chrome", 2);
        lib.set_text(&a.id, "Toʻlov muvaffaqiyatli: 150 000 soʻm", 1).unwrap();
        lib.set_text(&b.id, "Тошкент шаҳри, invoice #42", 1).unwrap();

        let find = |s: &str| -> Vec<String> {
            lib.list(&ListQuery { search: s.into(), ..Default::default() }).unwrap().items.into_iter().map(|s| s.app).collect()
        };
        assert_eq!(find("to'lov"), vec!["Telegram"]);
        assert_eq!(find("tolov"), vec!["Telegram"]);
        assert_eq!(find("toshkent"), vec!["Chrome"]);
        assert_eq!(find("Тошк"), vec!["Chrome"]);
        assert_eq!(find("invo"), vec!["Chrome"]);
        assert_eq!(find("telegram"), vec!["Telegram"]);
        assert!(find("nothing-here").is_empty());
        assert_eq!(find("").len(), 2);
    }

    #[test]
    fn trash_hides_and_filters_work() {
        let lib = Library::in_memory();
        let a = add(&lib, r"C:\s\a.png", "Edge", chrono::Local::now().timestamp_millis());
        let b = add(&lib, r"C:\s\b.png", "Edge", 0);
        lib.set_favorite(&b.id, true).unwrap();
        let q = |filter: &str| lib.list(&ListQuery { filter: filter.into(), ..Default::default() }).unwrap().total;
        assert_eq!((q("all"), q("favorites"), q("today")), (2, 1, 1));
        lib.set_trashed(&[a.id.clone()], Some(5)).unwrap();
        assert_eq!(q("all"), 1);
        assert_eq!(lib.trashed_before(10).unwrap(), vec![a.id.clone()]);
        lib.set_trashed(&[a.id.clone()], None).unwrap();
        assert_eq!(q("all"), 2);
        assert_eq!(lib.stats().unwrap().count, 2);
        assert_eq!(lib.apps().unwrap()[0].count, 2);
    }

    #[test]
    fn query_building() {
        assert_eq!(fts_query("  Hello  wor "), Some("\"hello\"* \"wor\"*".into()));
        assert_eq!(fts_query("o‘zbek"), Some("\"ozbek\"*".into()));
        assert_eq!(fts_query("   "), None);
    }
}
