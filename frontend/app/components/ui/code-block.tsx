import * as React from "react";
import type { SnippetLang } from "@/lib/snippets";
import { cn } from "@/lib/utils";

type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "type"
  | "func"
  | "flag";

interface Token {
  kind: TokenKind;
  text: string;
}

const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: "text-[var(--text-primary)]",
  comment: "italic text-[var(--code-comment)]",
  string: "text-[var(--code-string)]",
  keyword: "font-medium text-[var(--code-keyword)]",
  number: "text-[var(--code-number)]",
  type: "text-[var(--code-type)]",
  func: "text-[var(--code-func)]",
  flag: "text-[var(--code-flag)]",
};

const KEYWORDS: Record<SnippetLang | "json", Set<string>> = {
  python: new Set([
    "import",
    "from",
    "as",
    "with",
    "def",
    "return",
    "if",
    "else",
    "elif",
    "for",
    "in",
    "True",
    "False",
    "None",
    "print",
    "and",
    "or",
    "not",
  ]),
  typescript: new Set([
    "import",
    "from",
    "as",
    "const",
    "let",
    "var",
    "await",
    "async",
    "new",
    "return",
    "if",
    "else",
    "for",
    "of",
    "in",
    "true",
    "false",
    "null",
    "undefined",
  ]),
  csharp: new Set([
    "using",
    "var",
    "new",
    "await",
    "async",
    "return",
    "true",
    "false",
    "null",
    "float",
    "double",
    "string",
    "int",
    "long",
    "bool",
    "foreach",
    "for",
    "in",
    "if",
    "else",
    "class",
    "record",
    "static",
    "void",
    "public",
    "private",
  ]),
  curl: new Set(["curl", "redis-cli"]),
  sql: new Set([
    "SELECT",
    "FROM",
    "WHERE",
    "JOIN",
    "ON",
    "AND",
    "OR",
    "NOT",
    "ORDER",
    "BY",
    "ASC",
    "DESC",
    "LIMIT",
    "AS",
    "SHOW",
    "TABLES",
    "INFO",
    "FOR",
    "DB",
    "MATCH",
  ]),
  json: new Set(["true", "false", "null"]),
};

function isWordStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function tokenizeLine(line: string, lang: SnippetLang | "json"): Token[] {
  const tokens: Token[] = [];
  const kw = KEYWORDS[lang];
  let i = 0;

  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === kind) {
      prev.text += text;
    } else {
      tokens.push({ kind, text });
    }
  };

  while (i < line.length) {
    const rest = line.slice(i);

    // Line comments
    if (
      ((lang === "python" || lang === "curl") && rest.startsWith("#")) ||
      ((lang === "typescript" || lang === "csharp") && rest.startsWith("//")) ||
      (lang === "sql" && (rest.startsWith("--") || rest.startsWith("#")))
    ) {
      push("comment", rest);
      break;
    }

    // Triple-quoted Python strings on single line
    if (lang === "python" && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3);
      const end = line.indexOf(q, i + 3);
      const sliceEnd = end === -1 ? line.length : end + 3;
      push("string", line.slice(i, sliceEnd));
      i = sliceEnd;
      continue;
    }

    // Prefixed strings (Python r"...", f"...", C# @"...", $ "...", $@"...")
    if (
      (lang === "python" && /^[rfRF]["']/.test(rest)) ||
      (lang === "csharp" && /^(\$@|@\$|[@$])"/.test(rest))
    ) {
      const quoteIdx = rest.search(/["']/);
      const quote = rest[quoteIdx];
      let j = i + quoteIdx + 1;
      const isVerbatim = rest.slice(0, quoteIdx).includes("@");
      while (j < line.length) {
        if (!isVerbatim && line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push("string", line.slice(i, j));
      i = j;
      continue;
    }

    // Standard quoted strings
    if (
      line[i] === '"' ||
      line[i] === "'" ||
      (lang === "typescript" && line[i] === "`")
    ) {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push("string", line.slice(i, j));
      i = j;
      continue;
    }

    // CLI flags in curl
    if (
      lang === "curl" &&
      line[i] === "-" &&
      (i === 0 || /\s/.test(line[i - 1])) &&
      /^--?[A-Za-z-]+/.test(rest)
    ) {
      const m = rest.match(/^--?[A-Za-z-]+/)!;
      push("flag", m[0]);
      i += m[0].length;
      continue;
    }

    // Numbers (including C# 0.1f)
    if (
      /[0-9]/.test(line[i]) &&
      (i === 0 || !isWordChar(line[i - 1]))
    ) {
      const m = rest.match(/^[0-9]+(\.[0-9]+)?[fFdDmM]?/)!;
      push("number", m[0]);
      i += m[0].length;
      continue;
    }

    // Identifiers, keywords, types, functions
    if (isWordStart(line[i])) {
      let j = i + 1;
      while (j < line.length && isWordChar(line[j])) {
        j += 1;
      }
      const word = line.slice(i, j);
      const isFollowedByParen = line[j] === "(";
      const isKw =
        lang === "sql" ? kw.has(word.toUpperCase()) : kw.has(word);

      if (isKw) {
        push("keyword", word);
      } else if (isFollowedByParen) {
        push("func", word);
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && word !== "I") {
        push("type", word);
      } else {
        push("plain", word);
      }
      i = j;
      continue;
    }

    push("plain", line[i]);
    i += 1;
  }

  return tokens;
}

/** Theme-aware syntax-highlighted code block with non-selectable line numbers. */
export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language: SnippetLang | "json";
  className?: string;
}) {
  const lines = React.useMemo(() => code.split("\n"), [code]);

  return (
    <pre
      className={cn(
        "max-h-[54vh] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 font-mono text-[11px] leading-relaxed",
        className,
      )}
    >
      <code className="block min-w-max">
        {lines.map((line, idx) => {
          const tokens = tokenizeLine(line, language);
          return (
            <div
              key={idx}
              className="flex rounded px-1 hover:bg-[var(--bg-surface)]/70"
            >
              <span
                aria-hidden="true"
                className="mr-3.5 inline-block w-6 shrink-0 select-none text-right text-[10px] text-[var(--text-muted)]/60"
              >
                {idx + 1}
              </span>
              <span className="flex-1 whitespace-pre">
                {tokens.length === 0
                  ? "\u00A0"
                  : tokens.map((tok, tIdx) => (
                      <span key={tIdx} className={TOKEN_CLASSES[tok.kind]}>
                        {tok.text}
                      </span>
                    ))}
              </span>
            </div>
          );
        })}
      </code>
    </pre>
  );
}
