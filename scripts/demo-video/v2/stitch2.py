#!/usr/bin/env python3
"""Joins four 'zoom' captures (tl tr bl br) of css x 60..1650, y 0..890 into ../frames/<name>.jpg (2800x1568).
Used when the Chrome tool's frame is 1460x812 (regions: x 51/730/1409, y 0/380/760)."""
import os, subprocess, sys
name, *tiles = sys.argv[1:]
assert len(tiles) == 4
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frames", f"{name}.jpg")
cmd = ["ffmpeg", "-y", "-loglevel", "error"]
for t in tiles: cmd += ["-i", t]
cmd += ["-filter_complex", "[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack,scale=2800:1568:flags=lanczos", "-q:v", "3", out]
subprocess.run(cmd, check=True); print("wrote", out)
