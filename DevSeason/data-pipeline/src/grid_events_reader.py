"""
GRID events reader - streams messages from events.jsonl (plain or ZIP).

This module provides a unified interface for reading GRID event files
that may be plain JSONL or ZIP containers with inner JSONL files.
"""
import json
import zipfile
from pathlib import Path
from typing import Iterator, Dict, Any


# ZIP magic bytes
ZIP_MAGIC = b'PK\x03\x04'


def is_zip_file(file_path: Path) -> bool:
    """
    Check if file is a ZIP by reading magic bytes.

    Args:
        file_path: Path to file to check

    Returns:
        True if file starts with ZIP magic bytes
    """
    try:
        with open(file_path, 'rb') as f:
            return f.read(4) == ZIP_MAGIC
    except Exception:
        return False


def iter_messages(events_path: Path, max_lines: int = None) -> Iterator[Dict[str, Any]]:
    """
    Stream parsed JSON messages line by line from events.jsonl (plain or ZIP).

    Automatically detects if the file is a ZIP container by checking magic bytes.
    If ZIP, opens the inner *.jsonl file and streams lines.
    Never loads the full file into memory.

    Args:
        events_path: Path to events.jsonl file (plain or ZIP)
        max_lines: Optional maximum number of lines to read

    Yields:
        Parsed JSON message dictionaries (one per line)

    Raises:
        FileNotFoundError: If events_path doesn't exist
        ValueError: If ZIP contains no .jsonl file or file is invalid
    """
    if not events_path.exists():
        raise FileNotFoundError(f"Events file not found: {events_path}")

    # Check if it's a ZIP file
    if is_zip_file(events_path):
        # Handle ZIP container
        try:
            with zipfile.ZipFile(events_path, 'r') as zf:
                # Find *.jsonl file in archive
                jsonl_files = [name for name in zf.namelist() if name.endswith('.jsonl')]

                if not jsonl_files:
                    raise ValueError(f"No .jsonl file found in ZIP: {events_path}")

                # Use first .jsonl file found
                jsonl_name = jsonl_files[0]

                lines_read = 0
                with zf.open(jsonl_name, 'r') as f:
                    for line in f:
                        if max_lines and lines_read >= max_lines:
                            return

                        line = line.decode('utf-8').strip()
                        if line:
                            try:
                                yield json.loads(line)
                                lines_read += 1
                            except json.JSONDecodeError as e:
                                # Log warning but continue processing
                                print(f"Warning: JSON decode error at line {lines_read + 1}: {e}")
                                continue

        except zipfile.BadZipFile:
            raise ValueError(f"Corrupted ZIP file: {events_path}")

    else:
        # Handle plain JSONL file
        lines_read = 0
        with open(events_path, 'r', encoding='utf-8') as f:
            for line in f:
                if max_lines and lines_read >= max_lines:
                    return

                line = line.strip()
                if line:
                    try:
                        yield json.loads(line)
                        lines_read += 1
                    except json.JSONDecodeError as e:
                        # Log warning but continue processing
                        print(f"Warning: JSON decode error at line {lines_read + 1}: {e}")
                        continue


def count_messages(events_path: Path) -> int:
    """
    Count total number of messages in events file.

    Args:
        events_path: Path to events.jsonl file (plain or ZIP)

    Returns:
        Total count of messages
    """
    count = 0
    for _ in iter_messages(events_path):
        count += 1
    return count


def peek_first_message(events_path: Path) -> Dict[str, Any]:
    """
    Read and return the first message from events file.

    Args:
        events_path: Path to events.jsonl file (plain or ZIP)

    Returns:
        First message as dictionary

    Raises:
        ValueError: If file is empty or invalid
    """
    for message in iter_messages(events_path, max_lines=1):
        return message

    raise ValueError(f"No messages found in: {events_path}")
