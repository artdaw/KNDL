"""
KNDL Parser — Recursive descent parser for KNDL.

Consumes a token stream from the Lexer and produces an AST (Program).
Implements KNDL Specification v1.0.0, Sections 3–6.
"""

from __future__ import annotations

from typing import Optional

from .lexer import Lexer, Token, TokenType

from .ast_nodes import (
    ASTNode, Program, NodeDecl, EdgeDecl, TypeDecl, ContextDecl,
    IntentDecl, QueryDecl, ImportDecl, ExportDecl,
    NodeRef, VarBind, Literal, FieldAssignment, InlineEdge,
    MetaAnnotation, FieldDecl, TypeExpr, ConstraintExpr,
    MatchClause, EdgePattern, ReturnClause, AggField,
    TriggerClause, EmitAction,
    BinaryOp, UnaryOp, FuncCall, FieldAccess, IndexAccess,
    ArrayLiteral, MapLiteral, RangeExpr, DecayExpr,
    StateDecl, TransitionDecl, ProcessDecl,
)

# Unit atoms from the spec §2.8.9.  Used to recognise quantity literals.
_UNIT_ATOMS: frozenset[str] = frozenset({
    "°C", "°F", "K",
    "m", "cm", "mm", "km", "ft", "in",
    "kg", "g", "mg", "lb",
    "s", "ms", "min", "hr",
    "A", "V", "W", "Wh", "kWh", "J",
    "Pa", "kPa", "bar",
    "mol", "cd", "lm", "lx",
    "Hz", "kHz", "MHz", "GHz",
    "B", "KB", "MB", "GB", "TB",
    "bps", "kbps", "Mbps", "Gbps",
})


class ParseError(Exception):
    """Raised when the parser encounters a syntax error."""

    def __init__(self, message: str, token: Token):
        loc = f"{token.line}:{token.col}"
        super().__init__(f"Parse error at {loc}: {message} (got {token.type.name} '{token.value}')")
        self.token = token


class Parser:
    """
    Recursive descent parser for KNDL.

    Usage:
        parser = Parser(source_code)
        program = parser.parse()
    """

    def __init__(self, source: str):
        self.lexer = Lexer(source)
        self.tokens: list[Token] = list(self.lexer.tokenize())
        self.pos = 0

    # ── Token navigation ──

    def _current(self) -> Token:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return Token(TokenType.EOF, "", 0, 0)

    def _peek(self, offset: int = 0) -> Token:
        idx = self.pos + offset
        if idx < len(self.tokens):
            return self.tokens[idx]
        return Token(TokenType.EOF, "", 0, 0)

    def _advance(self) -> Token:
        tok = self._current()
        self.pos += 1
        return tok

    def _expect(self, tt: TokenType, msg: str = "") -> Token:
        tok = self._current()
        if tok.type != tt:
            err_msg = msg or f"Expected {tt.name}"
            raise ParseError(err_msg, tok)
        return self._advance()

    def _match(self, *types: TokenType) -> Optional[Token]:
        if self._current().type in types:
            return self._advance()
        return None

    def _at(self, *types: TokenType) -> bool:
        return self._current().type in types

    # ── Program (top-level) ──

    def parse(self) -> Program:
        """Parse a complete KNDL program."""
        prog = Program()

        while not self._at(TokenType.EOF):
            tok = self._current()

            if tok.type == TokenType.KW_NODE:
                prog.nodes.append(self._parse_node_decl())
            elif tok.type == TokenType.KW_EDGE:
                prog.edges.append(self._parse_edge_decl())
            elif tok.type == TokenType.KW_TYPE:
                prog.types.append(self._parse_type_decl())
            elif tok.type == TokenType.KW_CONTEXT:
                prog.contexts.append(self._parse_context_decl())
            elif tok.type == TokenType.KW_INTENT:
                prog.intents.append(self._parse_intent_decl())
            elif tok.type == TokenType.KW_QUERY:
                prog.queries.append(self._parse_query_decl())
            elif tok.type == TokenType.KW_IMPORT:
                prog.imports.append(self._parse_import_decl())
            elif tok.type == TokenType.KW_EXPORT:
                prog.exports.append(self._parse_export_decl())
            elif tok.type == TokenType.KW_PROCESS:
                prog.processes.append(self._parse_process_decl())
            else:
                raise ParseError(f"Unexpected top-level token, {tok}", tok)

        return prog

    # ── Node declaration ──

    def _parse_node_decl(self) -> NodeDecl:
        tok = self._expect(TokenType.KW_NODE)
        node = NodeDecl(line=tok.line, col=tok.col)

        ref_tok = self._expect(TokenType.NODE_REF, "Expected node reference (@name)")
        node.ref = self._make_node_ref(ref_tok)

        self._expect(TokenType.OP_DOUBLE_COLON, "Expected '::'")

        type_tok = self._expect(TokenType.IDENTIFIER, "Expected type name")
        node.type_name = type_tok.value

        self._expect(TokenType.LBRACE, "Expected '{'")
        self._parse_node_body(node)
        self._expect(TokenType.RBRACE, "Expected '}'")

        return node

    def _parse_node_body(self, node: NodeDecl) -> None:
        """Parse the body of a node: fields, inline edges, meta annotations."""
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            tok = self._current()

            if tok.type == TokenType.META_KEY:
                node.meta.append(self._parse_meta_annotation())
            elif tok.type == TokenType.IDENTIFIER:
                # Look ahead: is this field = value or field -> @ref?
                if self._peek(1).type == TokenType.OP_ARROW:
                    node.edges.append(self._parse_inline_edge())
                elif self._peek(1).type in (TokenType.OP_ASSIGN, TokenType.OP_PLUS_ASSIGN):
                    node.fields.append(self._parse_field_assignment())
                else:
                    raise ParseError("Expected '=' or '->' after field name", self._peek(1))
            else:
                raise ParseError("Unexpected token in node body", tok)

    def _parse_field_assignment(self) -> FieldAssignment:
        name_tok = self._expect(TokenType.IDENTIFIER)
        op = self._match(TokenType.OP_ASSIGN, TokenType.OP_PLUS_ASSIGN)
        if not op:
            raise ParseError("Expected '=' or '+='", self._current())
        value = self._parse_expression()
        fa = FieldAssignment(name=name_tok.value, value=value, line=name_tok.line, col=name_tok.col)
        return fa

    def _parse_inline_edge(self) -> InlineEdge:
        name_tok = self._expect(TokenType.IDENTIFIER)
        self._expect(TokenType.OP_ARROW)
        ref_tok = self._expect(TokenType.NODE_REF, "Expected node reference after '->'")
        return InlineEdge(
            field_name=name_tok.value,
            target=self._make_node_ref(ref_tok),
            line=name_tok.line,
            col=name_tok.col,
        )

    def _parse_meta_annotation(self) -> MetaAnnotation:
        key_tok = self._expect(TokenType.META_KEY)
        meta = MetaAnnotation(key=key_tok.value, line=key_tok.line, col=key_tok.col)

        # Parse value — could be simple, range (x .. y), or decay (x / dur)
        val = self._parse_expression()

        # Check for range (..)
        if self._match(TokenType.OP_RANGE):
            end = self._parse_expression()
            meta.value = RangeExpr(start=val, end=end, line=val.line, col=val.col)
        # Check for decay (/ duration)
        elif self._match(TokenType.OP_SLASH):
            dur = self._parse_expression()
            meta.value = DecayExpr(rate=val, duration=dur, line=val.line, col=val.col)
        else:
            meta.value = val

        return meta

    # ── Edge declaration ──

    def _parse_edge_decl(self) -> EdgeDecl:
        tok = self._expect(TokenType.KW_EDGE)
        edge = EdgeDecl(line=tok.line, col=tok.col)

        src_tok = self._expect(TokenType.NODE_REF, "Expected source node reference")
        edge.source = self._make_node_ref(src_tok)

        # Parse edge operator
        if self._match(TokenType.TYPED_ARROW_START):
            # -[T]->  (forward typed)  or  -[T]-  (undirected typed)
            type_tok = self._expect(TokenType.IDENTIFIER, "Expected edge type name")
            edge.edge_type = type_tok.value
            if self._at(TokenType.TYPED_ARROW_END):
                self._advance()  # consume ]->
                edge.direction = "forward"
            elif self._at(TokenType.RBRACKET):
                # Check for ]- (undirected)
                self._advance()  # consume ]
                self._expect(TokenType.OP_MINUS, "Expected '-' for undirected edge -[T]-")
                edge.direction = "undirected"
            else:
                raise ParseError("Expected ']->'" , self._current())
        elif self._at(TokenType.TYPED_BIARROW_START):
            # <-[T]-> (bidirectional) OR <-[T]- (reverse)
            self._advance()  # consume <-[
            type_tok = self._expect(TokenType.IDENTIFIER, "Expected edge type name")
            edge.edge_type = type_tok.value
            # Check what follows: ]-> is bidirectional, ]- is reverse
            if self._at(TokenType.TYPED_ARROW_END):
                # ]->) bidirectional
                self._advance()
                edge.direction = "bidirectional"
            elif self._at(TokenType.RBRACKET):
                # ] followed by -  => reverse
                self._advance()  # consume ]
                self._expect(TokenType.OP_MINUS, "Expected '-' for reverse edge <-[T]-")
                edge.direction = "reverse"
            else:
                raise ParseError("Expected ']->'" , self._current())
        elif self._match(TokenType.OP_ARROW):
            edge.direction = "forward"
        elif self._match(TokenType.OP_BIARROW):
            edge.direction = "bidirectional"
        else:
            raise ParseError("Expected edge operator (-> or -[type]->)", self._current())

        # Parse targets: single ref or array
        if self._at(TokenType.LBRACKET):
            self._advance()
            while not self._at(TokenType.RBRACKET, TokenType.EOF):
                ref_tok = self._expect(TokenType.NODE_REF)
                edge.targets.append(self._make_node_ref(ref_tok))
                if not self._match(TokenType.OP_COMMA):
                    break
            self._expect(TokenType.RBRACKET, "Expected ']'")
        else:
            ref_tok = self._expect(TokenType.NODE_REF, "Expected target node reference")
            edge.targets.append(self._make_node_ref(ref_tok))

        # Optional body
        if self._match(TokenType.LBRACE):
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                if self._at(TokenType.META_KEY):
                    edge.meta.append(self._parse_meta_annotation())
                elif self._at(TokenType.IDENTIFIER):
                    edge.fields.append(self._parse_field_assignment())
                else:
                    raise ParseError("Unexpected token in edge body", self._current())
            self._expect(TokenType.RBRACE)

        return edge

    # ── Type declaration ──

    def _parse_type_decl(self) -> TypeDecl:
        tok = self._expect(TokenType.KW_TYPE)
        td = TypeDecl(line=tok.line, col=tok.col)

        name_tok = self._expect(TokenType.IDENTIFIER, "Expected type name")
        td.name = name_tok.value

        # Optional = type_expr
        if self._match(TokenType.OP_ASSIGN):
            td.type_expr = self._parse_type_expr()

        # Optional struct body { fields }
        if self._match(TokenType.LBRACE):
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                fd = self._parse_field_decl()
                td.fields.append(fd)
            self._expect(TokenType.RBRACE)

        # Optional where { constraints }
        if self._match(TokenType.KW_WHERE):
            self._expect(TokenType.LBRACE)
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                expr = self._parse_expression()
                td.constraints.append(ConstraintExpr(expression=expr))
            self._expect(TokenType.RBRACE)

        return td

    def _parse_type_expr(self) -> TypeExpr:
        """Parse a type expression with union and intersection."""
        left = self._parse_type_primary()

        while self._at(TokenType.OP_AMP, TokenType.OP_PIPE):
            op_tok = self._advance()
            right = self._parse_type_primary()
            kind = "intersection" if op_tok.type == TokenType.OP_AMP else "union"
            combined = TypeExpr(kind=kind, children=[left, right], line=op_tok.line, col=op_tok.col)
            left = combined

        return left

    def _parse_type_primary(self) -> TypeExpr:
        tok = self._current()

        if tok.type == TokenType.STRING:
            self._advance()
            te = TypeExpr(name=tok.value, kind="literal", line=tok.line, col=tok.col)
        elif tok.type == TokenType.IDENTIFIER:
            self._advance()
            te = TypeExpr(name=tok.value, kind="named", line=tok.line, col=tok.col)
            # Parameterised type: Name<P1, P2, ...>
            if self._at(TokenType.OP_LT):
                self._advance()  # consume <
                te.kind = "parameterised"
                while not self._at(TokenType.OP_GT, TokenType.EOF):
                    te.params.append(self._parse_type_primary())
                    if not self._match(TokenType.OP_COMMA):
                        break
                self._expect(TokenType.OP_GT, "Expected '>' to close parameterised type")
        elif tok.type == TokenType.LBRACE:
            self._advance()
            te = TypeExpr(kind="struct", line=tok.line, col=tok.col)
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                te.fields.append(self._parse_field_decl())
            self._expect(TokenType.RBRACE)
        else:
            raise ParseError("Expected type expression", tok)

        # Optional ?
        if self._match(TokenType.OP_QUESTION):
            te = TypeExpr(kind="optional", children=[te], line=te.line, col=te.col)

        return te

    def _parse_field_decl(self) -> FieldDecl:
        name_tok = self._expect(TokenType.IDENTIFIER, "Expected field name")
        self._expect(TokenType.OP_COLON, "Expected ':'")
        type_expr = self._parse_type_expr()
        return FieldDecl(name=name_tok.value, type_expr=type_expr, line=name_tok.line, col=name_tok.col)

    # ── Context declaration ──

    def _parse_context_decl(self) -> ContextDecl:
        tok = self._expect(TokenType.KW_CONTEXT)
        ref_tok = self._expect(TokenType.NODE_REF)
        ctx = ContextDecl(ref=self._make_node_ref(ref_tok), line=tok.line, col=tok.col)

        self._expect(TokenType.LBRACE)
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            cur = self._current()
            if cur.type == TokenType.META_KEY:
                ctx.meta.append(self._parse_meta_annotation())
            elif cur.type == TokenType.KW_NODE:
                ctx.nodes.append(self._parse_node_decl())
            elif cur.type == TokenType.KW_EDGE:
                ctx.edges.append(self._parse_edge_decl())
            elif cur.type == TokenType.KW_INTENT:
                ctx.intents.append(self._parse_intent_decl())
            elif cur.type == TokenType.KW_CONTEXT:
                ctx.contexts.append(self._parse_context_decl())
            else:
                raise ParseError("Unexpected token in context body", cur)
        self._expect(TokenType.RBRACE)

        return ctx

    # ── Intent declaration ──

    def _parse_intent_decl(self) -> IntentDecl:
        tok = self._expect(TokenType.KW_INTENT)
        ref_tok = self._expect(TokenType.NODE_REF)
        self._expect(TokenType.OP_DOUBLE_COLON)
        type_tok = self._expect(TokenType.IDENTIFIER)

        intent = IntentDecl(
            ref=self._make_node_ref(ref_tok),
            type_name=type_tok.value,
            line=tok.line,
            col=tok.col,
        )

        self._expect(TokenType.LBRACE)
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            cur = self._current()
            if cur.type == TokenType.KW_TRIGGER:
                intent.trigger = self._parse_trigger_clause()
            elif cur.type == TokenType.KW_DO:
                intent.actions = self._parse_do_clause()
            elif cur.type == TokenType.META_KEY:
                intent.meta.append(self._parse_meta_annotation())
            else:
                raise ParseError("Unexpected token in intent body", cur)
        self._expect(TokenType.RBRACE)

        return intent

    def _parse_trigger_clause(self) -> TriggerClause:
        self._expect(TokenType.KW_TRIGGER)
        self._expect(TokenType.OP_ASSIGN)
        tok = self._current()

        if tok.type == TokenType.KW_QUERY:
            query = self._parse_query_decl()
            return TriggerClause(kind="query", query=query, line=tok.line, col=tok.col)
        elif tok.type == TokenType.KW_CRON:
            self._advance()
            cron_tok = self._expect(TokenType.STRING)
            return TriggerClause(kind="cron", cron_expr=cron_tok.value, line=tok.line, col=tok.col)
        else:
            expr = self._parse_expression()
            return TriggerClause(kind="expression", expression=expr, line=tok.line, col=tok.col)

    def _parse_do_clause(self) -> list[EmitAction]:
        self._expect(TokenType.KW_DO)
        self._expect(TokenType.LBRACE)
        actions = []

        while not self._at(TokenType.RBRACE, TokenType.EOF):
            if self._at(TokenType.KW_EMIT):
                self._advance()
                if self._at(TokenType.KW_NODE):
                    nd = self._parse_node_decl()
                    actions.append(EmitAction(node_decl=nd, action_type="create"))
                elif self._at(TokenType.KW_UPDATE):
                    self._advance()
                    ref_tok = self._expect(TokenType.NODE_REF)
                    self._expect(TokenType.LBRACE)
                    nd = NodeDecl(ref=self._make_node_ref(ref_tok))
                    self._parse_node_body(nd)
                    self._expect(TokenType.RBRACE)
                    actions.append(EmitAction(node_decl=nd, action_type="update", target_ref=nd.ref))
                elif self._at(TokenType.KW_DELETE):
                    self._advance()
                    ref_tok = self._expect(TokenType.NODE_REF)
                    actions.append(EmitAction(action_type="delete", target_ref=self._make_node_ref(ref_tok)))
                elif self._at(TokenType.OP_DOUBLE_COLON):
                    # emit :: Type { ... } (anonymous node)
                    self._advance()
                    type_tok = self._expect(TokenType.IDENTIFIER)
                    nd = NodeDecl(type_name=type_tok.value)
                    if self._match(TokenType.LBRACE):
                        self._parse_node_body(nd)
                        self._expect(TokenType.RBRACE)
                    actions.append(EmitAction(node_decl=nd, action_type="create"))
                else:
                    raise ParseError("Expected node declaration after 'emit'", self._current())
            elif self._at(TokenType.KW_GOTO):
                # goto STATE_NAME  (process transition action)
                self._advance()
                state_tok = self._expect(TokenType.IDENTIFIER, "Expected state name after 'goto'")
                actions.append(EmitAction(action_type="goto", goto_state=state_tok.value))
            else:
                raise ParseError("Expected 'emit' or 'goto' in do block", self._current())

        self._expect(TokenType.RBRACE)
        return actions

    # ── Query declaration ──

    def _parse_query_decl(self) -> QueryDecl:
        tok = self._expect(TokenType.KW_QUERY)
        query = QueryDecl(line=tok.line, col=tok.col)

        # Optional name
        if self._at(TokenType.IDENTIFIER):
            query.name = self._advance().value

        self._expect(TokenType.LBRACE)

        while not self._at(TokenType.RBRACE, TokenType.EOF):
            cur = self._current()
            if cur.type in (TokenType.KW_MATCH, TokenType.KW_OPTIONAL):
                query.matches.append(self._parse_match_clause())
            elif cur.type == TokenType.KW_WHERE:
                self._advance()
                query.where_expr = self._parse_expression()
            elif cur.type == TokenType.KW_RETURN:
                query.return_clause = self._parse_return_clause()
            elif cur.type == TokenType.KW_GROUP:
                self._advance()  # consume 'group'
                self._expect(TokenType.KW_BY, "Expected 'by' after 'group'")
                # parse comma-separated expressions
                query.group_by.append(self._parse_expression())
                while self._match(TokenType.OP_COMMA):
                    query.group_by.append(self._parse_expression())
            else:
                raise ParseError("Unexpected token in query body", cur)

        self._expect(TokenType.RBRACE)
        return query

    def _parse_match_clause(self) -> MatchClause:
        optional = bool(self._match(TokenType.KW_OPTIONAL))
        self._expect(TokenType.KW_MATCH)

        var_tok = self._expect(TokenType.VAR_BIND, "Expected variable binding (?name)")
        mc = MatchClause(
            variable=VarBind(name=var_tok.value, line=var_tok.line, col=var_tok.col),
            optional=optional,
            line=var_tok.line,
            col=var_tok.col,
        )

        self._expect(TokenType.OP_DOUBLE_COLON)
        type_tok = self._expect(TokenType.IDENTIFIER)
        mc.type_name = type_tok.value

        # Optional edge pattern
        if self._at(TokenType.TYPED_ARROW_START, TokenType.OP_ARROW):
            mc.edge_pattern = self._parse_edge_pattern()

        return mc

    def _parse_edge_pattern(self) -> EdgePattern:
        ep = EdgePattern(line=self._current().line, col=self._current().col)

        if self._match(TokenType.TYPED_ARROW_START):
            # -[T]-> or -[T*]-> or -[T*1..5]->
            type_tok = self._expect(TokenType.IDENTIFIER)
            ep.edge_type = type_tok.value
            # Optional hop quantifier: *  or  *N  or  *N..M
            if self._match(TokenType.OP_STAR):
                ep.hop_min = 1
                ep.hop_max = -1  # unbounded by default
                if self._at(TokenType.INT):
                    ep.hop_min = int(self._advance().value)
                    if self._match(TokenType.OP_RANGE):
                        if self._at(TokenType.INT):
                            ep.hop_max = int(self._advance().value)
                        # else *N.. → N to unbounded (-1)
                    else:
                        ep.hop_max = ep.hop_min  # exact N hops
            self._expect(TokenType.TYPED_ARROW_END)
        elif self._match(TokenType.OP_ARROW):
            ep.edge_type = "relates_to"
        else:
            raise ParseError("Expected edge operator", self._current())

        # Target: variable or node ref
        if self._at(TokenType.VAR_BIND):
            var_tok = self._advance()
            ep.target = VarBind(name=var_tok.value, line=var_tok.line, col=var_tok.col)
            if self._match(TokenType.OP_DOUBLE_COLON):
                type_tok = self._expect(TokenType.IDENTIFIER)
                ep.target_type = type_tok.value
        elif self._at(TokenType.NODE_REF):
            ref_tok = self._advance()
            ep.target = self._make_node_ref(ref_tok)
        else:
            raise ParseError("Expected variable or node reference", self._current())

        return ep

    def _parse_return_clause(self) -> ReturnClause:
        self._expect(TokenType.KW_RETURN)
        rc = ReturnClause(line=self._current().line, col=self._current().col)
        rc.expression = self._parse_expression()

        # Optional 'with edges N'
        if self._match(TokenType.KW_WITH):
            self._expect(TokenType.KW_EDGES)
            n_tok = self._expect(TokenType.INT)
            rc.with_edges = int(n_tok.value)

        # Optional 'aggregate { ... }'
        if self._match(TokenType.KW_AGGREGATE):
            self._expect(TokenType.LBRACE)
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                name_tok = self._expect(TokenType.IDENTIFIER)
                self._expect(TokenType.OP_ASSIGN)
                func_tok = self._current()
                if func_tok.type not in (
                    TokenType.KW_SUM, TokenType.KW_AVG, TokenType.KW_MIN,
                    TokenType.KW_MAX, TokenType.KW_COUNT, TokenType.KW_GROUP,
                    TokenType.IDENTIFIER,
                ):
                    raise ParseError("Expected aggregation function", func_tok)
                func_name = self._advance().value
                self._expect(TokenType.LPAREN)
                expr = self._parse_expression()
                self._expect(TokenType.RPAREN)
                rc.aggregations.append(AggField(name=name_tok.value, func=func_name, expr=expr))
            self._expect(TokenType.RBRACE)

        return rc

    # ── Process declaration ──

    def _parse_process_decl(self) -> ProcessDecl:
        """Parse: process @ref :: TypeName { states... transitions... meta... }"""
        tok = self._expect(TokenType.KW_PROCESS)
        pd = ProcessDecl(line=tok.line, col=tok.col)

        ref_tok = self._expect(TokenType.NODE_REF, "Expected node reference (@name)")
        pd.ref = self._make_node_ref(ref_tok)

        self._expect(TokenType.OP_DOUBLE_COLON, "Expected '::'")

        type_tok = self._expect(TokenType.IDENTIFIER, "Expected type name")
        pd.type_name = type_tok.value

        self._expect(TokenType.LBRACE, "Expected '{'")

        while not self._at(TokenType.RBRACE, TokenType.EOF):
            cur = self._current()
            if cur.type == TokenType.KW_STATE:
                pd.states.append(self._parse_state_decl())
            elif cur.type == TokenType.KW_ON:
                pd.transitions.append(self._parse_transition_decl())
            elif cur.type == TokenType.META_KEY:
                pd.meta.append(self._parse_meta_annotation())
            else:
                raise ParseError("Unexpected token in process body", cur)

        self._expect(TokenType.RBRACE, "Expected '}'")
        return pd

    def _parse_state_decl(self) -> StateDecl:
        """Parse: state NAME { meta... }"""
        self._expect(TokenType.KW_STATE)
        name_tok = self._expect(TokenType.IDENTIFIER, "Expected state name")
        sd = StateDecl(name=name_tok.value, line=name_tok.line, col=name_tok.col)

        if self._match(TokenType.LBRACE):
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                if self._at(TokenType.META_KEY):
                    sd.meta.append(self._parse_meta_annotation())
                else:
                    raise ParseError("Unexpected token in state body", self._current())
            self._expect(TokenType.RBRACE)

        return sd

    def _parse_transition_decl(self) -> TransitionDecl:
        """Parse: on EVENT in FROM_STATE -> TO_STATE [where EXPR] [do { actions }] [compensate { actions }]"""
        self._expect(TokenType.KW_ON)
        event_tok = self._expect(TokenType.IDENTIFIER, "Expected event name")
        self._expect(TokenType.KW_IN, "Expected 'in'")
        from_tok = self._expect(TokenType.IDENTIFIER, "Expected from-state name")
        self._expect(TokenType.OP_ARROW, "Expected '->'")
        to_tok = self._expect(TokenType.IDENTIFIER, "Expected to-state name")

        td = TransitionDecl(
            event=event_tok.value,
            from_state=from_tok.value,
            to_state=to_tok.value,
            line=event_tok.line,
            col=event_tok.col,
        )

        # Optional where
        if self._match(TokenType.KW_WHERE):
            td.where_expr = self._parse_expression()

        # Optional do { actions }
        if self._at(TokenType.KW_DO):
            td.actions = self._parse_do_clause()

        # Optional compensate { actions }
        if self._match(TokenType.KW_COMPENSATE):
            self._expect(TokenType.LBRACE)
            compensate_actions: list[EmitAction] = []
            while not self._at(TokenType.RBRACE, TokenType.EOF):
                if self._at(TokenType.KW_EMIT):
                    self._advance()
                    if self._at(TokenType.KW_NODE):
                        nd = self._parse_node_decl()
                        compensate_actions.append(EmitAction(node_decl=nd, action_type="create"))
                    elif self._at(TokenType.OP_DOUBLE_COLON):
                        self._advance()
                        type_tok = self._expect(TokenType.IDENTIFIER)
                        nd = NodeDecl(type_name=type_tok.value)
                        if self._match(TokenType.LBRACE):
                            self._parse_node_body(nd)
                            self._expect(TokenType.RBRACE)
                        compensate_actions.append(EmitAction(node_decl=nd, action_type="create"))
                    else:
                        raise ParseError("Expected node declaration after 'emit'", self._current())
                else:
                    raise ParseError("Expected 'emit' in compensate block", self._current())
            self._expect(TokenType.RBRACE)
            td.compensate_actions = compensate_actions

        return td

    # ── Import / Export ──

    def _parse_import_decl(self) -> ImportDecl:
        tok = self._expect(TokenType.KW_IMPORT)
        imp = ImportDecl(line=tok.line, col=tok.col)

        self._expect(TokenType.LBRACE)
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            name_tok = self._expect(TokenType.IDENTIFIER)
            imp.names.append(name_tok.value)
            self._match(TokenType.OP_COMMA)
        self._expect(TokenType.RBRACE)

        self._expect(TokenType.KW_FROM)
        src_tok = self._expect(TokenType.STRING)
        imp.source = src_tok.value

        return imp

    def _parse_export_decl(self) -> ExportDecl:
        tok = self._expect(TokenType.KW_EXPORT)
        cur = self._current()
        if cur.type == TokenType.KW_NODE:
            decl: ASTNode = self._parse_node_decl()
        elif cur.type == TokenType.KW_TYPE:
            decl = self._parse_type_decl()
        elif cur.type == TokenType.KW_CONTEXT:
            decl = self._parse_context_decl()
        elif cur.type == TokenType.KW_INTENT:
            decl = self._parse_intent_decl()
        else:
            raise ParseError("Expected declaration after 'export'", cur)

        return ExportDecl(declaration=decl, line=tok.line, col=tok.col)

    # ── Expression parser (Pratt / precedence climbing) ──

    def _parse_expression(self) -> ASTNode:
        return self._parse_or()

    def _parse_or(self) -> ASTNode:
        left = self._parse_and()
        while self._at(TokenType.OP_LOGICAL_OR, TokenType.KW_OR):
            op = self._advance()
            right = self._parse_and()
            left = BinaryOp(left=left, op="||", right=right, line=op.line, col=op.col)
        return left

    def _parse_and(self) -> ASTNode:
        left = self._parse_equality()
        while self._at(TokenType.OP_LOGICAL_AND, TokenType.KW_AND):
            op = self._advance()
            right = self._parse_equality()
            left = BinaryOp(left=left, op="&&", right=right, line=op.line, col=op.col)
        return left

    def _parse_equality(self) -> ASTNode:
        left = self._parse_comparison()
        while self._at(TokenType.OP_EQ, TokenType.OP_NEQ):
            op = self._advance()
            right = self._parse_comparison()
            left = BinaryOp(left=left, op=op.value, right=right, line=op.line, col=op.col)
        return left

    def _parse_comparison(self) -> ASTNode:
        left = self._parse_set_ops()
        while self._at(TokenType.OP_GT, TokenType.OP_LT, TokenType.OP_GTE, TokenType.OP_LTE):
            op = self._advance()
            right = self._parse_set_ops()
            left = BinaryOp(left=left, op=op.value, right=right, line=op.line, col=op.col)
        return left

    def _parse_set_ops(self) -> ASTNode:
        left = self._parse_addition()
        while self._at(TokenType.KW_IN, TokenType.KW_OVERLAPS, TokenType.KW_WITHIN, TokenType.KW_MATCHES):
            op = self._advance()
            right = self._parse_addition()
            left = BinaryOp(left=left, op=op.value, right=right, line=op.line, col=op.col)
        return left

    def _parse_addition(self) -> ASTNode:
        left = self._parse_multiplication()
        while self._at(TokenType.OP_PLUS, TokenType.OP_MINUS):
            op = self._advance()
            right = self._parse_multiplication()
            left = BinaryOp(left=left, op=op.value, right=right, line=op.line, col=op.col)
        return left

    def _parse_multiplication(self) -> ASTNode:
        left = self._parse_unary()
        while self._at(TokenType.OP_STAR, TokenType.OP_SLASH, TokenType.OP_PERCENT):
            op = self._advance()
            right = self._parse_unary()
            left = BinaryOp(left=left, op=op.value, right=right, line=op.line, col=op.col)
        return left

    def _parse_unary(self) -> ASTNode:
        if self._at(TokenType.KW_NOT):
            op = self._advance()
            operand = self._parse_unary()
            return UnaryOp(op="not", operand=operand, line=op.line, col=op.col)
        if self._at(TokenType.OP_MINUS):
            op = self._advance()
            operand = self._parse_unary()
            return UnaryOp(op="-", operand=operand, line=op.line, col=op.col)
        return self._parse_postfix()

    def _parse_postfix(self) -> ASTNode:
        expr = self._parse_primary()

        while True:
            if self._at(TokenType.OP_DOT):
                self._advance()
                if self._at(TokenType.META_KEY):
                    # .~confidence  etc.
                    tok = self._advance()
                    expr = FieldAccess(target=expr, field_name=f"~{tok.value}", line=tok.line, col=tok.col)
                else:
                    field_tok = self._expect(TokenType.IDENTIFIER, "Expected field name after '.'")
                    expr = FieldAccess(target=expr, field_name=field_tok.value, line=field_tok.line, col=field_tok.col)
            elif self._at(TokenType.LBRACKET):
                self._advance()
                index = self._parse_expression()
                self._expect(TokenType.RBRACKET)
                expr = IndexAccess(target=expr, index=index)
            else:
                break

        return expr

    def _try_quantity_unit(self) -> str | None:
        """If the next token is a recognised unit atom (and not a field name),
        consume it and return the full unit expression string; else return None."""
        if not self._at(TokenType.IDENTIFIER):
            return None
        unit_val = self._current().value
        if unit_val not in _UNIT_ATOMS:
            return None
        # Don't consume if followed by '=' / '->' / '::' / ':' — that means
        # this identifier is a field name, not a unit.
        nxt = self._peek(1).type
        if nxt in (TokenType.OP_ASSIGN, TokenType.OP_ARROW,
                   TokenType.OP_DOUBLE_COLON, TokenType.OP_COLON,
                   TokenType.OP_PLUS_ASSIGN):
            return None
        self._advance()  # consume unit atom
        unit_expr = unit_val
        # Handle composite units: m/s, kg*m, m/s^2 (^ not yet a token, skip for now)
        while self._at(TokenType.OP_SLASH, TokenType.OP_STAR):
            op_tok = self._advance()
            if self._at(TokenType.IDENTIFIER):
                unit_expr += op_tok.value + self._advance().value
            else:
                break
        return unit_expr

    def _parse_primary(self) -> ASTNode:
        tok = self._current()

        # Bytes literal: b"..."
        if tok.type == TokenType.BYTES:
            self._advance()
            return Literal(value=tok.value, kind="bytes", line=tok.line, col=tok.col)

        # Vector literal: v[f, f, ...]
        if tok.type == TokenType.VECTOR:
            self._advance()
            floats = [float(s.strip()) for s in tok.value.split(",") if s.strip()]
            return Literal(value=floats, kind="vector", line=tok.line, col=tok.col)

        # UUID literal: u"..."
        if tok.type == TokenType.UUID:
            self._advance()
            return Literal(value=tok.value, kind="uuid", line=tok.line, col=tok.col)

        # Literals
        if tok.type == TokenType.INT:
            self._advance()
            mag = int(tok.value)
            unit = self._try_quantity_unit()
            if unit:
                return Literal(value={"magnitude": mag, "unit": unit},
                               kind="quantity", line=tok.line, col=tok.col)
            return Literal(value=mag, kind="int", line=tok.line, col=tok.col)

        if tok.type == TokenType.FLOAT:
            self._advance()
            fmag = float(tok.value)
            unit = self._try_quantity_unit()
            if unit:
                return Literal(value={"magnitude": fmag, "unit": unit},
                               kind="quantity", line=tok.line, col=tok.col)
            return Literal(value=fmag, kind="float", line=tok.line, col=tok.col)

        if tok.type == TokenType.DECIMAL:
            self._advance()
            raw = tok.value.rstrip("d")
            decimal_val = float(raw)
            # Money: DECIMAL followed by an ISO 4217-style code (2–4 uppercase letters)
            if self._at(TokenType.IDENTIFIER):
                code = self._current().value
                if code.isupper() and code.isalpha() and 2 <= len(code) <= 4:
                    self._advance()
                    return Literal(value={"amount": decimal_val, "currency": code},
                                   kind="money", line=tok.line, col=tok.col)
            return Literal(value=decimal_val, kind="decimal", line=tok.line, col=tok.col)

        if tok.type == TokenType.STRING:
            self._advance()
            return Literal(value=tok.value, kind="string", line=tok.line, col=tok.col)

        if tok.type == TokenType.BOOL:
            self._advance()
            return Literal(value=(tok.value == "true"), kind="bool", line=tok.line, col=tok.col)

        if tok.type == TokenType.NULL:
            self._advance()
            return Literal(value=None, kind="null", line=tok.line, col=tok.col)

        if tok.type == TokenType.DURATION:
            self._advance()
            return Literal(value=tok.value, kind="duration", line=tok.line, col=tok.col)

        if tok.type == TokenType.DATETIME:
            self._advance()
            return Literal(value=tok.value, kind="datetime", line=tok.line, col=tok.col)

        # Star (wildcard, used in ranges like .. *)
        if tok.type == TokenType.OP_STAR:
            self._advance()
            return Literal(value="*", kind="string", line=tok.line, col=tok.col)

        # now keyword
        if tok.type == TokenType.KW_NOW:
            self._advance()
            return Literal(value="now", kind="datetime", line=tok.line, col=tok.col)

        # last keyword (e.g. 'last 30d')
        if tok.type == TokenType.KW_LAST:
            self._advance()
            dur = self._parse_expression()
            return FuncCall(name="last", args=[dur], line=tok.line, col=tok.col)

        # Node references
        if tok.type == TokenType.NODE_REF:
            self._advance()
            return self._make_node_ref(tok)

        # Variable bindings
        if tok.type == TokenType.VAR_BIND:
            self._advance()
            return VarBind(name=tok.value, line=tok.line, col=tok.col)

        # Parenthesized expression
        if tok.type == TokenType.LPAREN:
            self._advance()
            expr = self._parse_expression()
            self._expect(TokenType.RPAREN)
            return expr

        # Array literal
        if tok.type == TokenType.LBRACKET:
            return self._parse_array_literal()

        if tok.type == TokenType.MAP_OPEN:
            return self._parse_hash_map_literal()

        # Map literal (or anonymous struct — context determines) with { ... }
        if tok.type == TokenType.LBRACE:
            return self._parse_map_or_struct()

        # Function call, named struct, or bare identifier
        if tok.type == TokenType.IDENTIFIER:
            self._advance()
            if self._at(TokenType.LPAREN):
                self._advance()
                args = []
                while not self._at(TokenType.RPAREN, TokenType.EOF):
                    args.append(self._parse_expression())
                    if not self._match(TokenType.OP_COMMA):
                        break
                self._expect(TokenType.RPAREN)
                return FuncCall(name=tok.value, args=args, line=tok.line, col=tok.col)
            # Named struct literal: TypeName { key = val, ... }
            # Used for ~uncertainty gaussian { ... } and similar compound values
            if self._at(TokenType.LBRACE):
                self._advance()  # consume {
                pairs: list[tuple[ASTNode, ASTNode]] = [
                    (Literal(value="_type", kind="string"), Literal(value=tok.value, kind="string"))
                ]
                while not self._at(TokenType.RBRACE, TokenType.EOF):
                    k_tok = self._expect(TokenType.IDENTIFIER)
                    self._expect(TokenType.OP_ASSIGN)
                    v = self._parse_expression()
                    pairs.append((Literal(value=k_tok.value, kind="string"), v))
                    self._match(TokenType.OP_COMMA)
                self._expect(TokenType.RBRACE)
                return MapLiteral(pairs=pairs, line=tok.line, col=tok.col)
            return Literal(value=tok.value, kind="string", line=tok.line, col=tok.col)

        # Aggregation keywords used as identifiers in some contexts
        if tok.type in (TokenType.KW_SUM, TokenType.KW_AVG, TokenType.KW_MIN,
                        TokenType.KW_MAX, TokenType.KW_COUNT, TokenType.KW_GROUP):
            self._advance()
            if self._at(TokenType.LPAREN):
                self._advance()
                args = []
                while not self._at(TokenType.RPAREN, TokenType.EOF):
                    args.append(self._parse_expression())
                    if not self._match(TokenType.OP_COMMA):
                        break
                self._expect(TokenType.RPAREN)
                return FuncCall(name=tok.value, args=args, line=tok.line, col=tok.col)
            return Literal(value=tok.value, kind="string", line=tok.line, col=tok.col)

        raise ParseError("Expected expression", tok)

    def _parse_array_literal(self) -> ArrayLiteral:
        tok = self._expect(TokenType.LBRACKET)
        elements = []
        while not self._at(TokenType.RBRACKET, TokenType.EOF):
            elements.append(self._parse_expression())
            if not self._match(TokenType.OP_COMMA):
                break
        self._expect(TokenType.RBRACKET)
        return ArrayLiteral(elements=elements, line=tok.line, col=tok.col)

    def _parse_hash_map_literal(self) -> MapLiteral:
        """Parse a map literal: #{ key: value, ... }"""
        tok = self._expect(TokenType.MAP_OPEN)
        pairs = []
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            key = self._parse_expression()
            if self._match(TokenType.OP_COLON):
                val = self._parse_expression()
                pairs.append((key, val))
            elif self._match(TokenType.OP_ASSIGN):
                val = self._parse_expression()
                pairs.append((key, val))
            else:
                pairs.append((key, Literal(value=True, kind="bool")))
            self._match(TokenType.OP_COMMA)
        self._expect(TokenType.RBRACE)
        return MapLiteral(pairs=pairs, line=tok.line, col=tok.col)

    def _parse_map_or_struct(self) -> MapLiteral:
        tok = self._expect(TokenType.LBRACE)
        pairs = []
        while not self._at(TokenType.RBRACE, TokenType.EOF):
            key = self._parse_expression()
            if self._match(TokenType.OP_COLON):
                val = self._parse_expression()
                pairs.append((key, val))
            elif self._match(TokenType.OP_ASSIGN):
                val = self._parse_expression()
                pairs.append((key, val))
            else:
                pairs.append((key, Literal(value=True, kind="bool")))
            self._match(TokenType.OP_COMMA)
        self._expect(TokenType.RBRACE)
        return MapLiteral(pairs=pairs, line=tok.line, col=tok.col)

    # ── Helpers ──

    def _make_node_ref(self, tok: Token) -> NodeRef:
        raw = tok.value.lstrip("@")
        parts = raw.split(".")
        return NodeRef(path=parts, line=tok.line, col=tok.col)
