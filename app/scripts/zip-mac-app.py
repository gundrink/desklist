#!/usr/bin/env python3
"""Zip a .app bundle preserving symlinks and exec bits (electron-builder's zip on Linux dereferences
framework symlinks, which bloats the archive and breaks the bundle). Usage: zip-mac-app.py <dir-containing-Desklist.app> <out.zip>"""
import os, stat, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src, followlinks=False):
        for name in sorted(dirs + files):
            p = os.path.join(root, name)
            arc = os.path.relpath(p, src)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                zi = zipfile.ZipInfo(arc); zi.create_system = 3
                zi.external_attr = (stat.S_IFLNK | 0o755) << 16
                z.writestr(zi, os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                if os.path.islink(p): continue
                zi = zipfile.ZipInfo(arc + '/'); zi.create_system = 3
                zi.external_attr = (stat.S_IFDIR | 0o755) << 16
                z.writestr(zi, b'')
            else:
                zi = zipfile.ZipInfo.from_file(p, arc); zi.create_system = 3
                zi.external_attr = (st.st_mode & 0xFFFF) << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                with open(p, 'rb') as f: z.writestr(zi, f.read(), compresslevel=9)
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
