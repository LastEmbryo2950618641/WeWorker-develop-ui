import fs from 'node:fs';
import path from 'node:path';

const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
// Bound the snapshot before any browser action. Never follow directory links.
export function inspectLocalUpload(paths, directory = false) {
  if (!Array.isArray(paths) || !paths.length || paths.length > (directory ? 1 : 20)
    || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) fail('INVALID_ARGUMENT', 'Provide absolute paths: one directory or 1–20 files.');
  const stat = file => { try { return fs.lstatSync(file); } catch { fail('FILE_UNAVAILABLE', 'An upload entry is unavailable.'); } };
  if (!directory) return paths.map(file => {
    const info = stat(file);
    if (!info.isFile()) fail('INVALID_ARGUMENT', 'Upload paths must point to regular files, not links.');
    return {name:path.basename(file), size:info.size};
  });
  const root = paths[0], files = []; let entries = 0;
  if (!stat(root).isDirectory() || !path.basename(root)) fail('INVALID_ARGUMENT', 'Provide one named directory.');
  const walk = (folder, depth) => {
    if (depth > 16) fail('UPLOAD_LIMIT', 'Directory nesting exceeds 16 levels.');
    let names; try { names = fs.readdirSync(folder); } catch { fail('FILE_UNAVAILABLE', 'An upload directory cannot be read.'); }
    for (const name of names.sort()) {
      if (++entries > 500) fail('UPLOAD_LIMIT', 'Directory selection exceeds 500 entries.');
      const file = path.join(folder,name), info = stat(file);
      if (info.isSymbolicLink()) fail('INVALID_ARGUMENT', 'Directory uploads cannot contain symbolic links or junctions.');
      if (info.isDirectory()) walk(file, depth+1);
      else if (info.isFile()) {
        if (files.length >= 200) fail('UPLOAD_LIMIT', 'Directory selection exceeds 200 files.');
        files.push({name, size:info.size, relativePath:path.basename(root)+'/'+path.relative(root,file).split(path.sep).join('/')});
      } else fail('INVALID_ARGUMENT', 'Directory uploads require regular files.');
    }
  };
  walk(root,0);
  if (!files.length) fail('INVALID_ARGUMENT', 'Directory selection must contain a file.');
  return files;
}
