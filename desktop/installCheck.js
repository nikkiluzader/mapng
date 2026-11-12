// Is the app whole? The portable build is a zip: opened from inside the archive
// viewer (WinRAR, 7-Zip, Windows' own zip folders), only MapNG.exe is unpacked
// to a temporary folder and started there, without the files beside it. The
// window opens, and the first Generate ends with "Cannot find module
// ...\Temp\Rar$EXa...\resources\runner\generateJob.mjs" (problem report
// MR-QWWD99). Checked at start instead, with a message that says what to do.
import fs from 'node:fs';

/**
 * What is missing of the files the app needs beside its executable:
 * [] when whole. files: [{ path, what }].
 */
export function missingParts(files, exists = fs.existsSync) {
  return files.filter((f) => { try { return !exists(f.path); } catch { return true; } }).map((f) => f.what);
}

/** Whether a path is an archive viewer's temporary unpacking folder. */
export function inArchiveTemp(exePath) {
  const p = String(exePath || '').replace(/\\/g, '/').toLowerCase();
  return /\/rar\$[^/]*\//.test(p) || /\/7z[a-z0-9]{6,}\//.test(p) || /\/temp\d*_[^/]*\.zip\//.test(p) || /\.zip\//.test(p);
}

/** The message for an app that is not whole: { title, message, detail }. */
export function incompleteMessage(missing, exePath) {
  const fromArchive = inArchiveTemp(exePath);
  return {
    title: 'MapNG is not unpacked',
    message: fromArchive
      ? 'MapNG was started from inside the zip file.'
      : 'Some of MapNG\'s files are missing.',
    detail: `${fromArchive
      ? 'Only MapNG.exe was unpacked, without the files it needs beside it, so Generate and Export cannot run.'
      : 'Generate and Export cannot run without them.'}\n\nExtract the whole zip to a folder first (right-click the zip, Extract All), then run MapNG.exe from that folder.\n\nMissing: ${missing.join(', ')}.`,
  };
}
