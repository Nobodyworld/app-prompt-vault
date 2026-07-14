use std::env;
use std::fs;
use std::io::{self, BufRead};
use std::path::PathBuf;

fn tail_file(path: &PathBuf, lines: usize) -> io::Result<()> {
    let file = fs::File::open(path)?;
    let reader = io::BufReader::new(file);
    let all: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
    let start = if all.len() > lines {
        all.len() - lines
    } else {
        0
    };
    for line in &all[start..] {
        println!("{}", line);
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: dump_telemetry <telemetry-dir-or-file> [lines]");
        std::process::exit(2);
    }

    let path = PathBuf::from(&args[1]);
    let lines: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(200);

    if path.is_file() {
        if let Err(e) = tail_file(&path, lines) {
            eprintln!("error reading file {}: {}", path.display(), e);
        }
        return;
    }

    // If a directory is provided, read recent telemetry files
    if path.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&path)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                if let Some(n) = e.path().file_name().and_then(|s| s.to_str()) {
                    n.starts_with("telemetry-") && n.ends_with(".log")
                } else {
                    false
                }
            })
            .collect();
        entries.sort_by_key(|e| e.path());
        for entry in entries.iter().rev().take(5) {
            println!("--- file: {} ---", entry.path().display());
            let _ = tail_file(&entry.path(), lines);
        }
        return;
    }

    eprintln!(
        "Provided path is not a file or directory: {}",
        path.display()
    );
}
