/** Pick the readable foreground for an accent button, including its darkened hover. */
export function accentForeground(color: string, shade = 1): '#000' | '#fff' {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) {
    return '#fff';
  }
  const alpha = match[2] ? parseInt(match[2], 16) / 255 : 1;
  const base = [16, 25, 37];
  const channels = [0, 2, 4].map((offset, index) => {
    const value =
      (parseInt(match[1].slice(offset, offset + 2), 16) * shade * alpha +
        base[index] * (1 - alpha)) /
      255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000' : '#fff';
}
