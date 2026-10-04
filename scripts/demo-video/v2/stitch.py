#!/usr/bin/env python3
"""Joins four 'zoom' captures (top-left, top-right, bottom-left, bottom-right) of the app into one sharp
16:9 frame for the demo: python3 stitch.py <name> <tl> <tr> <bl> <br>  ->  ../frames/<name>.jpg (2800x1568).
Tiles are 730x395 units of the Chrome tool's 1512x791 frame (1710 css px wide, 1.818 px per css px).
Crops css x 60..1650, y 0..890, which is the area the scene rects (1600x896 space) are measured in."""
import os, subprocess, sys
name, *tiles = sys.argv[1:]
assert len(tiles) == 4
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "frames", f"{name}.jpg")
cmd = ["ffmpeg", "-y", "-loglevel", "error"]
for t in tiles: cmd += ["-i", t]
cmd += ["-filter_complex", "[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack,crop=2891:1618:25:0,scale=2800:1568:flags=lanczos", "-q:v", "3", out]
subprocess.run(cmd, check=True)
print("wrote", out)
