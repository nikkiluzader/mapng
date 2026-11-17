// Is the app whole? The portable build is a zip: opened from inside the archive
// viewer (WinRAR, 7-Zip, Windows' own zip folders), only MapNG.exe is unpacked
// to a temporary folder and started there, without the files beside it. The
// window opens, and the first Generate ends with "Cannot find module
// ...\Temp\Rar$EXa...\resources\runner\generateJob.mjs" (problem report
// MR-QWWD99). Checked at start instead, with a message that says what to do.
import fs from 'node:fs';
import { startText } from './menuText.js';

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

/** The message for an app that is not whole: { title, message, detail }, in the app's language. */
export function incompleteMessage(missing, exePath, language) {
  const s = startText(language);
  const fromArchive = inArchiveTemp(exePath);
  return {
    title: s.notUnpacked,
    message: fromArchive ? s.fromZip : s.filesMissing,
    detail: `${fromArchive ? s.fromZipDetail : s.filesMissingDetail}\n\n${s.extract}${missing.length ? `\n\n${s.missing.replace('{missing}', missing.join(', '))}` : ''}`,
  };
}

/** Graphics drawn in software: the feature status (app.getGPUFeatureStatus()) says the compositor has no card. */
export function softwareGraphics(status) {
  const v = String(status?.gpu_compositing || '');
  return /software|disabled/.test(v) && !/^enabled/.test(v);
}
