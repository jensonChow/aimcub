/**
 * Minimal glob → RegExp (zero dependencies, keeping core pure).
 * Supported wildcards: double-star plus slash = zero or more directory segments; double-star = anything across segments; single star = anything within a segment; question mark = a single character.
 * The path separator `/` is treated literally.
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
          re += "(?:.*/)?"; // '**/' → zero or more directory segments (including zero)
          i += 3;
        } else {
          re += ".*"; // '**' → anything across segments
          i += 2;
        }
      } else {
        re += "[^/]*"; // '*' → anything within a segment
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

/** Test `text` against `pattern` as a regex source; on an invalid regex, fall back to substring containment. */
export function matchesPattern(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return text.includes(pattern);
  }
}
