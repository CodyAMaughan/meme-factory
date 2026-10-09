#!/bin/sh
# Render every demo to MP4, then make README GIFs and the banner PNG in ../docs/media.
# Usage: scripts/render.sh [name ...]   (default: all)
set -e
cd "$(dirname "$0")/.."
out=../docs/media
mkdir -p renders "$out"
names=${*:-"hero remix post gallery anywhere safety"}
for name in $names; do
  src=$name.html
  [ "$name" = hero ] && src=index.html
  echo "rendering $name"
  npx --yes hyperframes@0.8.143 render -c "$src" --quality delivery -o "renders/$name.mp4" --quiet >/dev/null
  cp "renders/$name.mp4" "$out/$name.mp4"
  # GIFs autoplay in a README: 960px, 15fps, one palette per clip.
  ffmpeg -v error -y -i "renders/$name.mp4" \
    -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "$out/$name.gif"
  ls -lh "$out/$name.mp4" "$out/$name.gif" | awk '{print "  " $5 "  " $9}'
done
# The banner doubles as the GitHub social preview (1280x640).
rm -rf .work/banner && mkdir -p .work/banner && cp -R assets .work/banner/ && cp banner.html .work/banner/index.html
npx --yes hyperframes@0.8.143 snapshot .work/banner --at 0.5 --no-end -o .work/banner/shot >/dev/null 2>&1
cp .work/banner/shot/frame-00-at-0.5s.png "$out/banner.png"
echo "banner: $(sips -g pixelWidth -g pixelHeight $out/banner.png | tail -2 | awk '{print $2}' | tr '\n' 'x')"
