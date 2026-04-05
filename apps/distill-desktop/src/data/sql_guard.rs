use anyhow::{Result, bail};

pub fn guard_read_only_sql(sql: &str) -> Result<String> {
    let normalized = ensure_single_statement_sql(sql)?;
    let head = statement_head(&normalized);
    let allowed = matches!(head.as_str(), "select" | "with" | "pragma" | "explain");
    if !allowed {
        bail!("Only read-only SELECT, WITH, PRAGMA, and EXPLAIN statements are allowed.");
    }

    let lowered = normalized.to_lowercase();
    for forbidden in [
        "insert ", "update ", "delete ", "alter ", "drop ", "create ", "replace ", "attach ",
        "detach ", "vacuum", "reindex", "analyze",
    ] {
        if lowered.contains(forbidden) {
            bail!("Mutating SQL is not allowed in the desktop shell.");
        }
    }

    Ok(normalized)
}

fn statement_head(sql: &str) -> String {
    sql.split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn ensure_single_statement_sql(sql: &str) -> Result<String> {
    if sql.trim().is_empty() {
        bail!("SQL query is required.");
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum Mode {
        Normal,
        SingleQuote,
        DoubleQuote,
        Backtick,
        Bracket,
        LineComment,
        BlockComment,
    }

    let chars = sql.chars().collect::<Vec<_>>();
    let mut mode = Mode::Normal;
    let mut index = 0usize;
    while index < chars.len() {
        let current = chars[index];
        let next = chars.get(index + 1).copied();

        match mode {
            Mode::LineComment => {
                if current == '\n' {
                    mode = Mode::Normal;
                }
                index += 1;
                continue;
            }
            Mode::BlockComment => {
                if current == '*' && next == Some('/') {
                    mode = Mode::Normal;
                    index += 2;
                    continue;
                }
                index += 1;
                continue;
            }
            Mode::SingleQuote => {
                if current == '\'' {
                    if next == Some('\'') {
                        index += 2;
                        continue;
                    }
                    mode = Mode::Normal;
                }
                index += 1;
                continue;
            }
            Mode::DoubleQuote => {
                if current == '"' {
                    if next == Some('"') {
                        index += 2;
                        continue;
                    }
                    mode = Mode::Normal;
                }
                index += 1;
                continue;
            }
            Mode::Backtick => {
                if current == '`' {
                    mode = Mode::Normal;
                }
                index += 1;
                continue;
            }
            Mode::Bracket => {
                if current == ']' {
                    mode = Mode::Normal;
                }
                index += 1;
                continue;
            }
            Mode::Normal => {}
        }

        if current == '-' && next == Some('-') {
            mode = Mode::LineComment;
            index += 2;
            continue;
        }
        if current == '/' && next == Some('*') {
            mode = Mode::BlockComment;
            index += 2;
            continue;
        }
        if current == '\'' {
            mode = Mode::SingleQuote;
            index += 1;
            continue;
        }
        if current == '"' {
            mode = Mode::DoubleQuote;
            index += 1;
            continue;
        }
        if current == '`' {
            mode = Mode::Backtick;
            index += 1;
            continue;
        }
        if current == '[' {
            mode = Mode::Bracket;
            index += 1;
            continue;
        }

        if current == ';' {
            let remainder = chars[index + 1..].iter().collect::<String>();
            if remainder
                .chars()
                .any(|character| !character.is_whitespace())
            {
                bail!("Only one SQL statement is allowed per query.");
            }
        }

        index += 1;
    }

    Ok(sql.trim().trim_end_matches(';').trim().to_string())
}
