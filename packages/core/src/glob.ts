/**
 * 极简 glob → RegExp(零依赖,保持 core 纯净)。
 * 支持的通配:双星加斜杠 = 零或多段目录;双星 = 跨段任意;单星 = 段内任意;问号 = 单字符。
 * 路径分隔符 `/` 按字面处理。
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob.charAt(i + 1) === "*") {
        // '**'
        if (glob.charAt(i + 2) === "/") {
          re += "(?:.*/)?"; // '**/' → 零或多段目录(含零段)
          i += 3;
        } else {
          re += ".*"; // '**' → 跨段任意
          i += 2;
        }
      } else {
        re += "[^/]*"; // '*' → 段内任意
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp("^" + re + "$");
}

/** 把 pattern 当正则源测试 text;非法正则降级为子串包含。 */
export function matchesPattern(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return text.includes(pattern);
  }
}
