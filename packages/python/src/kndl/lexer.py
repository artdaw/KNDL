"""
KNDL Lexer — Tokenizer for the Knowledge Node Description Language.

Converts raw KNDL source text into a stream of typed tokens.
Implements KNDL Specification v0.2.0, Section 2 (Lexical Structure).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum, auto
from typing import Iterator


class TokenType(Enum):
    """All token types in the KNDL language."""

    # Literals
    INT = auto()
    FLOAT = auto()
    DECIMAL = auto()      # float with 'd' suffix (e.g. 19.99d)
    STRING = auto()
    BOOL = auto()
    NULL = auto()
    DURATION = auto()
    DATETIME = auto()
    BYTES = auto()        # b"base64..."
    VECTOR = auto()       # v[0.1, -0.2, 0.3]
    UUID = auto()         # u"0189..."

    # Identifiers & references
    IDENTIFIER = auto()
    NODE_REF = auto()       # @name or @name.sub
    VAR_BIND = auto()       # ?name
    META_KEY = auto()        # ~name

    # Keywords
    KW_NODE = auto()
    KW_EDGE = auto()
    KW_TYPE = auto()
    KW_INTENT = auto()
    KW_CONTEXT = auto()
    KW_QUERY = auto()
    KW_MATCH = auto()
    KW_WHERE = auto()
    KW_RETURN = auto()
    KW_WITH = auto()
    KW_EMIT = auto()
    KW_DO = auto()
    KW_TRIGGER = auto()
    KW_CRON = auto()
    KW_IF = auto()
    KW_ELSE = auto()
    KW_IN = auto()
    KW_AND = auto()
    KW_OR = auto()
    KW_NOT = auto()
    KW_TRUE = auto()
    KW_FALSE = auto()
    KW_NULL = auto()
    KW_NOW = auto()
    KW_LAST = auto()
    KW_WITHIN = auto()
    KW_OVERLAPS = auto()
    KW_AGGREGATE = auto()
    KW_SUM = auto()
    KW_AVG = auto()
    KW_MIN = auto()
    KW_MAX = auto()
    KW_COUNT = auto()
    KW_GROUP = auto()
    KW_AS = auto()
    KW_IMPORT = auto()
    KW_EXPORT = auto()
    KW_FROM = auto()
    KW_OPTIONAL = auto()
    KW_EDGES = auto()
    KW_UPDATE = auto()
    KW_DELETE = auto()
    KW_MATCHES = auto()
    # v0.2 keywords
    KW_PROCESS = auto()
    KW_STATE = auto()
    KW_ON = auto()
    KW_GOTO = auto()
    KW_COMPENSATE = auto()
    KW_BY = auto()
    KW_OF = auto()

    # Operators
    OP_ASSIGN = auto()       # =
    OP_DOUBLE_COLON = auto() # ::
    OP_COLON = auto()        # :
    OP_ARROW = auto()        # ->
    OP_BIARROW = auto()      # <->
    OP_RANGE = auto()        # ..
    OP_DOT = auto()          # .
    OP_COMMA = auto()        # ,
    OP_QUESTION = auto()     # ?
    OP_AMP = auto()          # &
    OP_PIPE = auto()         # |
    OP_STAR = auto()         # *
    OP_SLASH = auto()        # /
    OP_PERCENT = auto()      # %
    OP_PLUS = auto()         # +
    OP_MINUS = auto()        # -
    OP_GT = auto()           # >
    OP_LT = auto()           # <
    OP_GTE = auto()          # >=
    OP_LTE = auto()          # <=
    OP_EQ = auto()           # ==
    OP_NEQ = auto()          # !=
    OP_LOGICAL_AND = auto()  # &&
    OP_LOGICAL_OR = auto()   # ||
    OP_PLUS_ASSIGN = auto()  # +=

    # Delimiters
    LBRACE = auto()          # {
    RBRACE = auto()          # }
    LBRACKET = auto()        # [
    RBRACKET = auto()        # ]
    LPAREN = auto()          # (
    RPAREN = auto()          # )
    MAP_OPEN = auto()        # #{

    # Typed edge markers
    TYPED_ARROW_START = auto()   # -[
    TYPED_ARROW_END = auto()     # ]->
    TYPED_BIARROW_START = auto() # <-[
    TYPED_BIARROW_END = auto()   # ]->  (same token, context-dependent)

    # Special
    NEWLINE = auto()
    EOF = auto()
    ERROR = auto()


@dataclass(frozen=True, slots=True)
class Token:
    """A single lexical token."""
    type: TokenType
    value: str
    line: int
    col: int

    def __repr__(self) -> str:
        val = self.value if len(self.value) <= 30 else self.value[:27] + "..."
        return f"Token({self.type.name}, {val!r}, {self.line}:{self.col})"


# ── Keyword map ──
KEYWORDS: dict[str, TokenType] = {
    "node": TokenType.KW_NODE,
    "edge": TokenType.KW_EDGE,
    "type": TokenType.KW_TYPE,
    "intent": TokenType.KW_INTENT,
    "context": TokenType.KW_CONTEXT,
    "query": TokenType.KW_QUERY,
    "match": TokenType.KW_MATCH,
    "where": TokenType.KW_WHERE,
    "return": TokenType.KW_RETURN,
    "with": TokenType.KW_WITH,
    "emit": TokenType.KW_EMIT,
    "do": TokenType.KW_DO,
    "trigger": TokenType.KW_TRIGGER,
    "cron": TokenType.KW_CRON,
    "if": TokenType.KW_IF,
    "else": TokenType.KW_ELSE,
    "in": TokenType.KW_IN,
    "and": TokenType.KW_AND,
    "or": TokenType.KW_OR,
    "not": TokenType.KW_NOT,
    "true": TokenType.KW_TRUE,
    "false": TokenType.KW_FALSE,
    "null": TokenType.KW_NULL,
    "now": TokenType.KW_NOW,
    "last": TokenType.KW_LAST,
    "within": TokenType.KW_WITHIN,
    "overlaps": TokenType.KW_OVERLAPS,
    "aggregate": TokenType.KW_AGGREGATE,
    "sum": TokenType.KW_SUM,
    "avg": TokenType.KW_AVG,
    "min": TokenType.KW_MIN,
    "max": TokenType.KW_MAX,
    "count": TokenType.KW_COUNT,
    "group": TokenType.KW_GROUP,
    "as": TokenType.KW_AS,
    "import": TokenType.KW_IMPORT,
    "export": TokenType.KW_EXPORT,
    "from": TokenType.KW_FROM,
    "optional": TokenType.KW_OPTIONAL,
    "edges": TokenType.KW_EDGES,
    "update": TokenType.KW_UPDATE,
    "delete": TokenType.KW_DELETE,
    "matches": TokenType.KW_MATCHES,
    # v0.2 keywords
    "process": TokenType.KW_PROCESS,
    "state": TokenType.KW_STATE,
    "on": TokenType.KW_ON,
    "goto": TokenType.KW_GOTO,
    "compensate": TokenType.KW_COMPENSATE,
    "by": TokenType.KW_BY,
    "of": TokenType.KW_OF,
}

# Duration units (v0.2 adds ns, us, mo, y)
DURATION_UNITS = {"ms", "ns", "us", "mo", "s", "m", "h", "d", "w", "y"}

# Datetime regex
_DATETIME_RE = re.compile(
    r"\d{4}-(?:\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|Q[1-4]|W\d{2})"
)


class LexerError(Exception):
    """Raised when the lexer encounters an invalid token."""

    def __init__(self, message: str, line: int, col: int):
        super().__init__(f"Lexer error at {line}:{col}: {message}")
        self.line = line
        self.col = col


class Lexer:
    """
    Tokenizer for KNDL source text.

    Usage:
        lexer = Lexer(source_code)
        tokens = list(lexer.tokenize())
    """

    def __init__(self, source: str):
        self.source = source
        self.pos = 0
        self.line = 1
        self.col = 1

    @property
    def _at_end(self) -> bool:
        return self.pos >= len(self.source)

    def _peek(self, offset: int = 0) -> str:
        idx = self.pos + offset
        if idx >= len(self.source):
            return "\0"
        return self.source[idx]

    def _advance(self) -> str:
        ch = self.source[self.pos]
        self.pos += 1
        if ch == "\n":
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return ch

    def _match(self, expected: str) -> bool:
        if self.pos < len(self.source) and self.source[self.pos] == expected:
            self._advance()
            return True
        return False

    def _lookahead(self, text: str) -> bool:
        return self.source[self.pos : self.pos + len(text)] == text

    def _skip_whitespace_and_comments(self) -> None:
        while not self._at_end:
            ch = self._peek()

            # Whitespace (not newlines)
            if ch in (" ", "\t", "\r"):
                self._advance()
                continue

            # Newlines
            if ch == "\n":
                return  # Let caller handle newlines

            # Line comments
            if ch == "/" and self._peek(1) == "/":
                while not self._at_end and self._peek() != "\n":
                    self._advance()
                continue

            # Block comments
            if ch == "/" and self._peek(1) == "*":
                self._advance()  # /
                self._advance()  # *
                depth = 1
                while not self._at_end and depth > 0:
                    if self._peek() == "/" and self._peek(1) == "*":
                        depth += 1
                        self._advance()
                    elif self._peek() == "*" and self._peek(1) == "/":
                        depth -= 1
                        self._advance()
                    self._advance()
                continue

            break

    def _read_string(self) -> str:
        """Read a double-quoted string literal."""
        result: list[str] = []
        self._advance()  # opening "
        while not self._at_end:
            ch = self._advance()
            if ch == '"':
                return "".join(result)
            if ch == "\\":
                esc = self._advance()
                if esc == '"':
                    result.append('"')
                elif esc == "\\":
                    result.append("\\")
                elif esc == "n":
                    result.append("\n")
                elif esc == "r":
                    result.append("\r")
                elif esc == "t":
                    result.append("\t")
                elif esc == "/":
                    result.append("/")
                elif esc == "u":
                    hex_str = ""
                    for _ in range(4):
                        hex_str += self._advance()
                    result.append(chr(int(hex_str, 16)))
                else:
                    result.append(esc)
            else:
                result.append(ch)
        raise LexerError("Unterminated string literal", self.line, self.col)

    def _read_number_or_datetime(self, start_line: int, start_col: int) -> Token:
        """Read a number, duration, datetime, or decimal literal."""
        start = self.pos - 1  # We already consumed the first digit

        # Collect digits
        while not self._at_end and (self._peek().isdigit() or self._peek() == "_"):
            self._advance()

        # Check for datetime: NNNN- pattern
        text_so_far = self.source[start : self.pos]
        if len(text_so_far) == 4 and not self._at_end and self._peek() == "-":
            # Might be a datetime
            _remaining = self.source[self.pos :]
            m = _DATETIME_RE.match(self.source[start:])
            if m:
                full = m.group(0)
                # Advance past the rest
                while self.pos < start + len(full):
                    self._advance()
                return Token(TokenType.DATETIME, full, start_line, start_col)

        # Check for hex/binary
        if text_so_far == "0" and not self._at_end:
            if self._peek() in ("x", "X"):
                self._advance()
                while not self._at_end and self._peek() in "0123456789abcdefABCDEF_":
                    self._advance()
                return Token(TokenType.INT, self.source[start : self.pos], start_line, start_col)
            if self._peek() in ("b", "B"):
                self._advance()
                while not self._at_end and self._peek() in "01_":
                    self._advance()
                return Token(TokenType.INT, self.source[start : self.pos], start_line, start_col)

        # Check for float
        is_float = False
        if not self._at_end and self._peek() == ".":
            # Disambiguate from range operator (..)
            if self._peek(1) != ".":
                is_float = True
                self._advance()  # .
                while not self._at_end and (self._peek().isdigit() or self._peek() == "_"):
                    self._advance()

        # Check for exponent
        if not self._at_end and self._peek() in ("e", "E"):
            is_float = True
            self._advance()
            if not self._at_end and self._peek() in ("+", "-"):
                self._advance()
            while not self._at_end and self._peek().isdigit():
                self._advance()

        # Check for decimal suffix ('d' after a float, e.g. 19.99d)
        # Must be a float (has decimal point) followed by 'd' not followed by more alpha chars
        if is_float and not self._at_end and self._peek() == "d":
            next_after = self._peek(1)
            if not next_after.isalpha() and next_after != "_":
                self._advance()  # consume 'd'
                val = self.source[start : self.pos].replace("_", "")
                return Token(TokenType.DECIMAL, val, start_line, start_col)

        # Check for duration suffix
        if not self._at_end:
            suffix_start = self.pos
            suffix = ""
            # Read up to 2 alpha chars for suffix
            while not self._at_end and self._peek().isalpha() and len(suffix) < 2:
                suffix += self._peek()
                self.pos += 1
            if suffix in DURATION_UNITS:
                return Token(TokenType.DURATION, self.source[start : self.pos], start_line, start_col)
            self.pos = suffix_start  # Reset if not a valid duration

        val = self.source[start : self.pos].replace("_", "")
        return Token(
            TokenType.FLOAT if is_float else TokenType.INT,
            val,
            start_line,
            start_col,
        )

    def _read_identifier_or_keyword(self, start_line: int, start_col: int) -> Token:
        """Read an identifier or keyword, or a prefixed literal (b\", v[, u\")."""
        start = self.pos - 1
        while not self._at_end and (self._peek().isalnum() or self._peek() == "_"):
            self._advance()
        text = self.source[start : self.pos]

        # Bytes literal: b"..."
        if text == "b" and not self._at_end and self._peek() == '"':
            content = self._read_string()
            return Token(TokenType.BYTES, content, start_line, start_col)

        # Vector literal: v[f, f, ...]
        if text == "v" and not self._at_end and self._peek() == "[":
            self._advance()  # consume '['
            vec_start = self.pos
            depth = 1
            while not self._at_end and depth > 0:
                if self._peek() == "[":
                    depth += 1
                elif self._peek() == "]":
                    depth -= 1
                if depth > 0:
                    self._advance()
            content = self.source[vec_start : self.pos].strip()
            if not self._at_end:
                self._advance()  # consume ']'
            return Token(TokenType.VECTOR, content, start_line, start_col)

        # UUID literal: u"..."
        if text == "u" and not self._at_end and self._peek() == '"':
            content = self._read_string()
            return Token(TokenType.UUID, content, start_line, start_col)

        # Check keywords
        if text in KEYWORDS:
            tt = KEYWORDS[text]
            if tt == TokenType.KW_TRUE:
                return Token(TokenType.BOOL, "true", start_line, start_col)
            if tt == TokenType.KW_FALSE:
                return Token(TokenType.BOOL, "false", start_line, start_col)
            if tt == TokenType.KW_NULL:
                return Token(TokenType.NULL, "null", start_line, start_col)
            return Token(tt, text, start_line, start_col)

        return Token(TokenType.IDENTIFIER, text, start_line, start_col)

    def _read_node_ref(self, start_line: int, start_col: int) -> Token:
        """Read a node reference (@identifier.sub)."""
        start = self.pos - 1  # We consumed @
        while not self._at_end and (self._peek().isalnum() or self._peek() in ("_", ".")):
            # Don't consume trailing . before .
            if self._peek() == "." and (self._at_end or not self.source[self.pos + 1 :self.pos + 2].isalnum()):
                if self._peek(1) == ".":
                    break  # That's the range operator
                break
            self._advance()
        return Token(TokenType.NODE_REF, self.source[start : self.pos], start_line, start_col)

    def tokenize(self) -> Iterator[Token]:
        """Generate a stream of tokens from the source."""
        while not self._at_end:
            self._skip_whitespace_and_comments()
            if self._at_end:
                break

            start_line = self.line
            start_col = self.col
            ch = self._advance()

            # Newlines
            if ch == "\n":
                continue  # Skip newlines as tokens (whitespace-insensitive)

            # Strings
            if ch == '"':
                self.pos -= 1
                self.col -= 1
                sl, sc = self.line, self.col
                val = self._read_string()
                yield Token(TokenType.STRING, val, sl, sc)
                continue

            # Node references
            if ch == "@":
                yield self._read_node_ref(start_line, start_col)
                continue

            # Meta keys
            if ch == "~":
                ms = self.pos
                while not self._at_end and (self._peek().isalnum() or self._peek() in ("_", ":")):
                    self._advance()
                yield Token(TokenType.META_KEY, self.source[ms : self.pos], start_line, start_col)
                continue

            # Variable bindings
            if ch == "?":
                if not self._at_end and self._peek().isalpha():
                    vs = self.pos
                    while not self._at_end and (self._peek().isalnum() or self._peek() == "_"):
                        self._advance()
                    yield Token(TokenType.VAR_BIND, self.source[vs : self.pos], start_line, start_col)
                else:
                    yield Token(TokenType.OP_QUESTION, "?", start_line, start_col)
                continue

            # Numbers and datetimes
            if ch.isdigit():
                yield self._read_number_or_datetime(start_line, start_col)
                continue

            # Negative numbers
            if ch == "-" and not self._at_end and self._peek().isdigit():
                yield self._read_number_or_datetime(start_line, start_col)
                continue

            # Identifiers and keywords
            if ch.isalpha() or ch == "_":
                yield self._read_identifier_or_keyword(start_line, start_col)
                continue

            # Degree symbol — start of temperature unit atom (°C, °F, °K)
            if ch == "°":
                unit_str = ch
                while not self._at_end and self._peek().isalpha():
                    unit_str += self._advance()
                yield Token(TokenType.IDENTIFIER, unit_str, start_line, start_col)
                continue

            # Multi-character operators
            if ch == ":":
                if self._match(":"):
                    yield Token(TokenType.OP_DOUBLE_COLON, "::", start_line, start_col)
                else:
                    yield Token(TokenType.OP_COLON, ":", start_line, start_col)
                continue

            if ch == "-":
                if self._match(">"):
                    yield Token(TokenType.OP_ARROW, "->", start_line, start_col)
                elif self._match("["):
                    yield Token(TokenType.TYPED_ARROW_START, "-[", start_line, start_col)
                else:
                    yield Token(TokenType.OP_MINUS, "-", start_line, start_col)
                continue

            if ch == "<":
                if self._match("-"):
                    if self._match(">"):
                        yield Token(TokenType.OP_BIARROW, "<->", start_line, start_col)
                    elif self._match("["):
                        yield Token(TokenType.TYPED_BIARROW_START, "<-[", start_line, start_col)
                    else:
                        yield Token(TokenType.OP_LT, "<", start_line, start_col)
                        yield Token(TokenType.OP_MINUS, "-", start_line, start_col)
                elif self._match("="):
                    yield Token(TokenType.OP_LTE, "<=", start_line, start_col)
                else:
                    yield Token(TokenType.OP_LT, "<", start_line, start_col)
                continue

            if ch == ">":
                if self._match("="):
                    yield Token(TokenType.OP_GTE, ">=", start_line, start_col)
                else:
                    yield Token(TokenType.OP_GT, ">", start_line, start_col)
                continue

            if ch == "=":
                if self._match("="):
                    yield Token(TokenType.OP_EQ, "==", start_line, start_col)
                else:
                    yield Token(TokenType.OP_ASSIGN, "=", start_line, start_col)
                continue

            if ch == "!":
                if self._match("="):
                    yield Token(TokenType.OP_NEQ, "!=", start_line, start_col)
                else:
                    yield Token(TokenType.ERROR, "!", start_line, start_col)
                continue

            if ch == "&":
                if self._match("&"):
                    yield Token(TokenType.OP_LOGICAL_AND, "&&", start_line, start_col)
                else:
                    yield Token(TokenType.OP_AMP, "&", start_line, start_col)
                continue

            if ch == "|":
                if self._match("|"):
                    yield Token(TokenType.OP_LOGICAL_OR, "||", start_line, start_col)
                else:
                    yield Token(TokenType.OP_PIPE, "|", start_line, start_col)
                continue

            if ch == ".":
                if self._match("."):
                    yield Token(TokenType.OP_RANGE, "..", start_line, start_col)
                else:
                    yield Token(TokenType.OP_DOT, ".", start_line, start_col)
                continue

            if ch == "+":
                if self._match("="):
                    yield Token(TokenType.OP_PLUS_ASSIGN, "+=", start_line, start_col)
                else:
                    yield Token(TokenType.OP_PLUS, "+", start_line, start_col)
                continue

            if ch == "]":
                # Use lookahead to check for ]-> before consuming any characters.
                # Without lookahead, _match("-") would consume "-" even when ">" doesn't follow.
                if self._lookahead("->"):
                    self._advance()  # -
                    self._advance()  # >
                    yield Token(TokenType.TYPED_ARROW_END, "]->", start_line, start_col)
                else:
                    yield Token(TokenType.RBRACKET, "]", start_line, start_col)
                continue

            # Hash — check for #{ (MAP_OPEN)
            if ch == "#":
                if self._match("{"):
                    yield Token(TokenType.MAP_OPEN, "#{", start_line, start_col)
                else:
                    yield Token(TokenType.ERROR, "#", start_line, start_col)
                continue

            # Single-character tokens
            simple: dict[str, TokenType] = {
                "{": TokenType.LBRACE,
                "}": TokenType.RBRACE,
                "[": TokenType.LBRACKET,
                "(": TokenType.LPAREN,
                ")": TokenType.RPAREN,
                ",": TokenType.OP_COMMA,
                "*": TokenType.OP_STAR,
                "/": TokenType.OP_SLASH,
                "%": TokenType.OP_PERCENT,
            }
            if ch in simple:
                yield Token(simple[ch], ch, start_line, start_col)
                continue

            # Unknown character
            raise LexerError(f"Unexpected character: {ch!r}", start_line, start_col)

        yield Token(TokenType.EOF, "", self.line, self.col)
