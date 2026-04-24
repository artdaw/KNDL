"""
KNDL — Knowledge Node Description Language

A semantic-first, confidence-aware, graph-structured language
for AI agent knowledge representation.

Usage:
    import kndl

    # Parse KNDL source
    program = kndl.parse(source_text)

    # Compile to runtime graph
    graph = kndl.compile(source_text)

    # Query nodes
    nodes = graph.query_nodes(type_name="Temperature", min_confidence=0.8)

    # Serialize back to KNDL text
    text = kndl.serialize(graph)

    # Convert to JSON-compatible dict
    data = graph.to_dict()
"""

__version__ = "1.0.0"

from .lexer import Lexer, Token, LexerError
from .parser import Parser, ParseError
from .ast_nodes import Program
from .graph import KNDLGraph, GraphNode, GraphEdge, GraphIntent, KNDLMeta
from .compiler import Compiler
from .serializer import Serializer

__all__ = [
    # Public API
    "parse", "compile", "serialize", "tokenize",
    # Types
    "KNDLGraph", "GraphNode", "GraphEdge", "GraphIntent", "KNDLMeta",
    # Errors
    "LexerError", "ParseError",
    # AST (for advanced use)
    "Program",
]


def parse(source: str) -> Program:
    """Parse KNDL source text into an AST."""
    return Parser(source).parse()


def compile(source: str) -> KNDLGraph:  # noqa: A001
    """Parse and compile KNDL source text into a runtime graph."""
    return Compiler().compile(parse(source))


def serialize(graph: KNDLGraph) -> str:
    """Serialize a KNDLGraph back to KNDL text format."""
    return Serializer().serialize(graph)


def tokenize(source: str) -> list[Token]:
    """Tokenize KNDL source text into a list of tokens."""
    return list(Lexer(source).tokenize())
