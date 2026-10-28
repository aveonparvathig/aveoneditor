const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';

export const env = {
  isMac: /macintosh|mac os x|mac_powerpc/.test(ua) || /iphone|ipad|ipod/.test(ua),
  isWindows: /windows/.test(ua),
  isGecko: /gecko\/\d+/.test(ua) && !/like gecko/.test(ua),
  isSafari: /safari/.test(ua) && !/chrome|android/.test(ua),
  isiOS: /iphone|ipad|ipod/.test(ua),
  isAndroid: /android/.test(ua),
  isBlink: /chrome\//.test(ua) && !/edge\//.test(ua)
};
