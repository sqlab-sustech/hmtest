/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as ts from 'ohos-typescript';
import { Local } from '../base/Local';
import { ArkAssignStmt, ArkIfStmt, ArkReturnStmt, ArkReturnVoidStmt, Stmt } from '../base/Stmt';
import { BasicBlock } from '../graph/BasicBlock';
import { Cfg } from '../graph/Cfg';
import { ArkClass } from '../model/ArkClass';
import { ArkMethod } from '../model/ArkMethod';
import { ArkIRTransformer, DUMMY_INITIALIZER_STMT } from './ArkIRTransformer';
import { ModelUtils } from './ModelUtils';
import { AbstractInvokeExpr } from '../base/Expr';
import { Builtin } from './Builtin';
import { IRUtils } from './IRUtils';
import { AliasType, AliasTypeDeclaration } from '../base/Type';

class StatementBuilder {
    type: string;
    //节点对应源代码    
    code: string;
    next: StatementBuilder | null;
    lasts: Set<StatementBuilder>;
    walked: boolean;
    index: number;
    // TODO:以下两个属性需要获取    
    line: number;//行号//ast节点存了一个start值为这段代码的起始地址，可以从start开始往回查原文有几个换行符确定行号    
    column: number; // 列  
    astNode: ts.Node | null;//ast节点对象
    scopeID: number;
    addressCode3: string[] = [];
    block: Block | null;
    ifExitPass: boolean;
    passTmies: number = 0;
    numOfIdentifier: number = 0;
    isDoWhile: boolean = false;

    constructor(type: string, code: string, astNode: ts.Node | null, scopeID: number) {
        this.type = type;
        this.code = code;
        this.next = null;
        this.lasts = new Set();
        this.walked = false;
        this.index = 0;
        this.line = -1;
        this.column = -1;
        this.astNode = astNode;
        this.scopeID = scopeID;
        this.block = null;
        this.ifExitPass = false;
    }
}

class ConditionStatementBuilder extends StatementBuilder {
    nextT: StatementBuilder | null;
    nextF: StatementBuilder | null;
    loopBlock: Block | null;
    condition: string;
    doStatement: StatementBuilder | null = null;

    constructor(type: string, code: string, astNode: ts.Node, scopeID: number) {
        super(type, code, astNode, scopeID);
        this.nextT = null;
        this.nextF = null;
        this.loopBlock = null;
        this.condition = '';
    }
}

class SwitchStatementBuilder extends StatementBuilder {
    nexts: StatementBuilder[];
    cases: Case[] = [];
    default: StatementBuilder | null = null;

    constructor(type: string, code: string, astNode: ts.Node, scopeID: number) {
        super(type, code, astNode, scopeID);
        this.nexts = [];
    }
}

class TryStatementBuilder extends StatementBuilder {
    tryFirst: StatementBuilder | null = null;
    tryExit: StatementBuilder | null = null;
    catchStatement: StatementBuilder | null = null;
    catchError: string = '';
    finallyStatement: StatementBuilder | null = null;

    constructor(type: string, code: string, astNode: ts.Node, scopeID: number) {
        super(type, code, astNode, scopeID);
    }
}

class Case {
    value: string;
    stmt: StatementBuilder;

    constructor(value: string, stmt: StatementBuilder) {
        this.value = value;
        this.stmt = stmt;
    }
}

class DefUseChain {
    def: StatementBuilder;
    use: StatementBuilder;

    constructor(def: StatementBuilder, use: StatementBuilder) {
        this.def = def;
        this.use = use;
    }
}

class Variable {
    name: string;
    lastDef: StatementBuilder;
    defUse: DefUseChain[];
    properties: Variable[] = [];
    propOf: Variable | null = null;

    constructor(name: string, lastDef: StatementBuilder) {
        this.name = name;
        this.lastDef = lastDef;
        this.defUse = [];
    }
}

class Scope {
    id: number;
    level: number;
    parent: Scope | null;

    constructor(id: number, variable: Set<String>, level: number) {
        this.id = id;
        this.level = level;
        this.parent = null;
    }
}

class Block {
    id: number;
    stmts: StatementBuilder[];
    nexts: Block[] = [];
    lasts: Block[] = [];
    walked: boolean = false;

    constructor(id: number, stmts: StatementBuilder[]) {
        this.id = id;
        this.stmts = stmts;
    }
}

class Catch {
    errorName: string;
    from: number;
    to: number;
    withLabel: number;

    constructor(errorName: string, from: number, to: number, withLabel: number) {
        this.errorName = errorName;
        this.from = from;
        this.to = to;
        this.withLabel = withLabel;
    }
}

class textError extends Error {
    constructor(message: string) {
        // 调用父类的构造函数，并传入错误消息
        super(message);

        // 设置错误类型的名称
        this.name = 'textError';
    }
}

export class CfgBuilder {
    name: string;
    astRoot: ts.Node;
    entry: StatementBuilder;
    exit: StatementBuilder;
    loopStack: ConditionStatementBuilder[];
    switchExitStack: StatementBuilder[];
    functions: CfgBuilder[];
    breakin: string;
    statementArray: StatementBuilder[];
    dotEdges: number[][];
    scopes: Scope[];
    scopeLevel: number;
    tempVariableNum: number;
    current3ACstm: StatementBuilder;
    blocks: Block[];
    currentDeclarationKeyword: string;
    variables: Variable[];
    declaringClass: ArkClass;
    importFromPath: string[];
    catches: Catch[];
    exits: StatementBuilder[] = [];
    emptyBody: boolean = false;
    arrowFunctionWithoutBlock: boolean = false;

    private sourceFile: ts.SourceFile;
    private declaringMethod: ArkMethod;

    constructor(ast: ts.Node, name: string, declaringMethod: ArkMethod, sourceFile: ts.SourceFile) {
        this.name = name;
        this.astRoot = ast;
        this.declaringMethod = declaringMethod;
        this.declaringClass = declaringMethod.getDeclaringArkClass();
        this.entry = new StatementBuilder('entry', '', ast, 0);
        this.loopStack = [];
        this.switchExitStack = [];
        this.functions = [];
        this.breakin = '';
        this.statementArray = [];
        this.dotEdges = [];
        this.exit = new StatementBuilder('exit', 'return;', null, 0);
        this.scopes = [];
        this.scopeLevel = 0;
        this.tempVariableNum = 0;
        this.current3ACstm = this.entry;
        this.blocks = [];
        this.currentDeclarationKeyword = '';
        this.variables = [];
        this.importFromPath = [];
        this.catches = [];
        this.sourceFile = sourceFile;
        this.arrowFunctionWithoutBlock = true;
    }

    walkAST(lastStatement: StatementBuilder, nextStatement: StatementBuilder, nodes: ts.Node[]) {
        function judgeLastType(s: StatementBuilder) {
            if (lastStatement.type === 'ifStatement') {
                let lastIf = lastStatement as ConditionStatementBuilder;
                if (lastIf.nextT == null) {
                    lastIf.nextT = s;
                    s.lasts.add(lastIf);
                } else {
                    lastIf.nextF = s;
                    s.lasts.add(lastIf);
                }
            } else if (lastStatement.type === 'loopStatement') {
                let lastLoop = lastStatement as ConditionStatementBuilder;
                lastLoop.nextT = s;
                s.lasts.add(lastLoop);
            } else if (lastStatement.type === 'catchOrNot') {
                let lastLoop = lastStatement as ConditionStatementBuilder;
                lastLoop.nextT = s;
                s.lasts.add(lastLoop);
            } else {
                lastStatement.next = s;
                s.lasts.add(lastStatement);
            }

        }

        this.scopeLevel++;
        let scope = new Scope(this.scopes.length, new Set(), this.scopeLevel);
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].level === this.scopeLevel - 1) {
                scope.parent = this.scopes[i];
                break;
            }
        }
        this.scopes.push(scope);

        for (let i = 0; i < nodes.length; i++) {
            let c = nodes[i];
            if (ts.isVariableStatement(c) || ts.isExpressionStatement(c) || ts.isThrowStatement(c) || ts.isTypeAliasDeclaration(c)) {
                let s = new StatementBuilder('statement', c.getText(this.sourceFile), c, scope.id);
                judgeLastType(s);
                lastStatement = s;
            } else if (!this.declaringMethod.isDefaultArkMethod() && ts.isFunctionDeclaration(c)) {
                let s = new StatementBuilder('functionDeclarationStatement', c.getText(this.sourceFile), c, scope.id);
                judgeLastType(s);
                lastStatement = s;
            } else if (ts.isReturnStatement(c)) {
                let s = new StatementBuilder('returnStatement', c.getText(this.sourceFile), c, scope.id);
                judgeLastType(s);
                s.astNode = c;
                lastStatement = s;
                break;
            } else if (ts.isBreakStatement(c)) {
                let p: ts.Node | null = c;
                while (p) {
                    if (ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p)) {
                        const lastLoopNextF = this.loopStack[this.loopStack.length - 1].nextF!;
                        judgeLastType(lastLoopNextF);
                        lastLoopNextF.lasts.add(lastStatement);
                        return;
                    }
                    if (ts.isCaseClause(p) || ts.isDefaultClause(p)) {
                        const lastSwitchExit = this.switchExitStack[this.switchExitStack.length - 1];
                        judgeLastType(lastSwitchExit);
                        lastSwitchExit.lasts.add(lastStatement);
                        return;
                    }
                    p = p.parent;
                }
            } else if (ts.isContinueStatement(c)) {
                const lastLoop = this.loopStack[this.loopStack.length - 1];
                judgeLastType(lastLoop);
                lastLoop.lasts.add(lastStatement);
                return;
            } else if (ts.isIfStatement(c)) {
                let ifstm: ConditionStatementBuilder = new ConditionStatementBuilder('ifStatement', '', c, scope.id);
                judgeLastType(ifstm);
                let ifexit: StatementBuilder = new StatementBuilder('ifExit', '', c, scope.id);
                this.exits.push(ifexit);
                ifstm.condition = c.expression.getText(this.sourceFile);
                ifstm.code = 'if (' + ifstm.condition + ')';
                if (ts.isBlock(c.thenStatement)) {
                    this.walkAST(ifstm, ifexit, [...c.thenStatement.statements]);
                } else {
                    this.walkAST(ifstm, ifexit, [c.thenStatement]);
                }
                if (c.elseStatement) {
                    if (ts.isBlock(c.elseStatement)) {
                        this.walkAST(ifstm, ifexit, [...c.elseStatement.statements]);
                    } else {
                        this.walkAST(ifstm, ifexit, [c.elseStatement]);
                    }
                }
                if (!ifstm.nextT) {
                    ifstm.nextT = ifexit;
                    ifexit.lasts.add(ifstm);
                }
                if (!ifstm.nextF) {
                    ifstm.nextF = ifexit;
                    ifexit.lasts.add(ifstm);
                }
                lastStatement = ifexit;
            } else if (ts.isWhileStatement(c)) {
                this.breakin = 'loop';
                let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scope.id);
                this.loopStack.push(loopstm);
                judgeLastType(loopstm);
                let loopExit = new StatementBuilder('loopExit', '', c, scope.id);
                this.exits.push(loopExit);
                loopstm.nextF = loopExit;
                loopExit.lasts.add(loopstm);
                loopstm.condition = c.expression.getText(this.sourceFile);
                loopstm.code = 'while (' + loopstm.condition + ')';
                if (ts.isBlock(c.statement)) {
                    this.walkAST(loopstm, loopstm, [...c.statement.statements]);
                } else {
                    this.walkAST(loopstm, loopstm, [c.statement]);
                }
                if (!loopstm.nextF) {
                    loopstm.nextF = loopExit;
                    loopExit.lasts.add(loopstm);
                }
                if (!loopstm.nextT) {
                    loopstm.nextT = loopExit;
                    loopExit.lasts.add(loopstm);
                }
                lastStatement = loopExit;
                this.loopStack.pop();
            }
            if (ts.isForStatement(c) || ts.isForInStatement(c) || ts.isForOfStatement(c)) {
                this.breakin = 'loop';
                let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scope.id);
                this.loopStack.push(loopstm);
                judgeLastType(loopstm);
                let loopExit = new StatementBuilder('loopExit', '', c, scope.id);
                this.exits.push(loopExit);
                loopstm.nextF = loopExit;
                loopExit.lasts.add(loopstm);
                loopstm.code = 'for (';
                if (ts.isForStatement(c)) {
                    loopstm.code += c.initializer?.getText(this.sourceFile) + '; ' + c.condition?.getText(this.sourceFile) + '; ' + c.incrementor?.getText(this.sourceFile);
                } else if (ts.isForOfStatement(c)) {
                    loopstm.code += c.initializer?.getText(this.sourceFile) + ' of ' + c.expression.getText(this.sourceFile);
                } else {
                    loopstm.code += c.initializer?.getText(this.sourceFile) + ' in ' + c.expression.getText(this.sourceFile);
                }
                loopstm.code += ')';
                if (ts.isBlock(c.statement)) {
                    this.walkAST(loopstm, loopstm, [...c.statement.statements]);
                } else {
                    this.walkAST(loopstm, loopstm, [c.statement]);
                }
                if (!loopstm.nextF) {
                    loopstm.nextF = loopExit;
                    loopExit.lasts.add(loopstm);
                }
                if (!loopstm.nextT) {
                    loopstm.nextT = loopExit;
                    loopExit.lasts.add(loopstm);
                }
                lastStatement = loopExit;
                this.loopStack.pop();
            } else if (ts.isDoStatement(c)) {
                this.breakin = 'loop';
                let loopstm = new ConditionStatementBuilder('loopStatement', '', c, scope.id);
                this.loopStack.push(loopstm);
                let loopExit = new StatementBuilder('loopExit', '', c, scope.id);
                this.exits.push(loopExit);
                loopstm.nextF = loopExit;
                loopExit.lasts.add(loopstm);
                loopstm.condition = c.expression.getText(this.sourceFile);
                loopstm.code = 'while (' + loopstm.condition + ')';
                loopstm.isDoWhile = true;
                if (ts.isBlock(c.statement)) {
                    this.walkAST(lastStatement, loopstm, [...c.statement.statements]);
                } else {
                    this.walkAST(lastStatement, loopstm, [c.statement]);
                }
                let lastType = lastStatement.type;
                if (lastType === 'ifStatement' || lastType === 'loopStatement') {
                    let lastCondition = lastStatement as ConditionStatementBuilder;
                    loopstm.nextT = lastCondition.nextT;
                    lastCondition.nextT?.lasts.add(loopstm);
                } else {
                    loopstm.nextT = lastStatement.next;
                    lastStatement.next?.lasts.add(loopstm);
                }
                if (loopstm.nextT && loopstm.nextT !== loopstm) {
                    loopstm.nextT.isDoWhile = true;
                    loopstm.doStatement = loopstm.nextT;
                }
                lastStatement = loopExit;
                this.loopStack.pop();
            } else if (ts.isSwitchStatement(c)) {
                this.breakin = 'switch';
                let switchstm = new SwitchStatementBuilder('switchStatement', '', c, scope.id);
                judgeLastType(switchstm);
                let switchExit = new StatementBuilder('switchExit', '', null, scope.id);
                this.exits.push(switchExit);
                this.switchExitStack.push(switchExit);
                switchstm.code = 'switch (' + c.expression + ')';
                let lastCaseExit: StatementBuilder | null = null;
                for (let i = 0; i < c.caseBlock.clauses.length; i++) {
                    const clause = c.caseBlock.clauses[i];
                    let casestm: StatementBuilder;
                    if (ts.isCaseClause(clause)) {
                        casestm = new StatementBuilder('statement', 'case ' + clause.expression.getText(this.sourceFile) + ':', clause, scope.id);
                    } else {
                        casestm = new StatementBuilder('statement', 'default:', clause, scope.id);
                    }

                    switchstm.nexts.push(casestm);
                    casestm.lasts.add(switchstm);
                    let caseExit = new StatementBuilder('caseExit', '', null, scope.id);
                    this.exits.push(caseExit);
                    this.walkAST(casestm, caseExit, [...clause.statements]);
                    if (ts.isCaseClause(clause)) {
                        const cas = new Case(casestm.code, casestm.next!);
                        switchstm.cases.push(cas);
                    } else {
                        switchstm.default = casestm.next;
                    }
                    // case: 之类的代码不会被三地址码识别，可能会导致空block，暂时删除
                    switchstm.nexts[switchstm.nexts.length - 1] = casestm.next!;
                    for (const stmt of [...casestm.lasts]) {
                        casestm.next!.lasts.add(stmt);
                    }
                    casestm.next!.lasts.delete(casestm);

                    if (lastCaseExit) {
                        lastCaseExit.next = casestm.next;
                        casestm.next?.lasts.add(lastCaseExit);
                    }
                    lastCaseExit = caseExit;
                    if (i === c.caseBlock.clauses.length - 1) {
                        caseExit.next = switchExit;
                        switchExit.lasts.add(caseExit);
                    }
                }

                lastStatement = switchExit;
                this.switchExitStack.pop();
            } else if (ts.isBlock(c)) {
                let blockExit = new StatementBuilder('blockExit', '', c, scope.id);
                this.exits.push(blockExit);
                this.walkAST(lastStatement, blockExit, c.getChildren(this.sourceFile)[1].getChildren(this.sourceFile));
                lastStatement = blockExit;
            } else if (ts.isTryStatement(c)) {
                let trystm = new TryStatementBuilder('tryStatement', 'try', c, scope.id);
                judgeLastType(trystm);
                let tryExit = new StatementBuilder('tryExit', '', c, scope.id);
                this.exits.push(tryExit);
                trystm.tryExit = tryExit;
                this.walkAST(trystm, tryExit, [...c.tryBlock.statements]);
                trystm.tryFirst = trystm.next;
                trystm.next?.lasts.add(trystm);
                if (c.catchClause) {
                    let text = 'catch';
                    if (c.catchClause.variableDeclaration) {
                        text += '(' + c.catchClause.variableDeclaration.getText(this.sourceFile) + ')';
                    }
                    let catchOrNot = new ConditionStatementBuilder('catchOrNot', text, c, scope.id);
                    let catchExit = new StatementBuilder('catch exit', '', c, scope.id);
                    catchOrNot.nextF = catchExit;
                    catchExit.lasts.add(catchOrNot);
                    this.walkAST(catchOrNot, catchExit, [...c.catchClause.block.statements]);
                    if (!catchOrNot.nextT) {
                        catchOrNot.nextT = catchExit;
                        catchExit.lasts.add(catchOrNot);
                    }
                    const catchStatement = new StatementBuilder('statement', catchOrNot.code, c.catchClause, catchOrNot.nextT.scopeID);
                    catchStatement.next = catchOrNot.nextT;
                    trystm.catchStatement = catchStatement;
                    catchStatement.lasts.add(trystm);
                    if (c.catchClause.variableDeclaration) {
                        trystm.catchError = c.catchClause.variableDeclaration.getText(this.sourceFile);
                    } else {
                        trystm.catchError = 'Error';
                    }

                }
                if (c.finallyBlock && c.finallyBlock.statements.length > 0) {
                    let final = new StatementBuilder('statement', 'finally', c, scope.id);
                    let finalExit = new StatementBuilder('finallyExit', '', c, scope.id);
                    this.exits.push(finalExit);
                    this.walkAST(final, finalExit, [...c.finallyBlock.statements]);
                    trystm.finallyStatement = final.next;
                    tryExit.next = final;
                    final.next?.lasts.add(tryExit);
                    lastStatement = finalExit;
                } else {
                    lastStatement = tryExit;
                }
            }

        }
        this.scopeLevel--;
        if (lastStatement.type !== 'breakStatement' && lastStatement.type !== 'continueStatement' && lastStatement.type !== 'returnStatement') {
            lastStatement.next = nextStatement;
            nextStatement.lasts.add(lastStatement);
        }
    }

    addReturnInEmptyMethod() {
        if (this.entry.next === this.exit) {
            const ret = new StatementBuilder('returnStatement', 'return;', null, this.entry.scopeID);
            this.entry.next = ret;
            ret.lasts.add(this.entry);
            ret.next = this.exit;
            this.exit.lasts = new Set([ret]);
        }
    }

    deleteExit() {
        for (const exit of this.exits) {
            for (const last of [...exit.lasts]) {
                if (last instanceof ConditionStatementBuilder) {
                    if (last.nextT === exit) {
                        last.nextT = exit.next;
                        const lasts = exit.next!.lasts;
                        lasts.delete(exit);
                        lasts.add(last);
                    } else if (last.nextF === exit) {
                        last.nextF = exit.next;
                        const lasts = exit.next!.lasts;
                        lasts.delete(exit);
                        lasts.add(last);
                    }
                } else if (last instanceof SwitchStatementBuilder) {
                    for (let i = 0; i < last.nexts.length; i++) {
                        const stmt = last.nexts[i];
                        if (stmt === exit) {
                            last.nexts[i] = exit.next!;
                            const lasts = exit.next!.lasts;
                            lasts.delete(exit);
                            lasts.add(last);
                        }
                    }
                } else {
                    last.next = exit.next;
                    const lasts = exit.next!.lasts;
                    lasts.delete(exit);
                    lasts.add(last);
                }
            }
        }
        // 部分语句例如return后面的exit语句的next无法在上面清除
        for (const exit of this.exits) {
            if (exit.next && exit.next.lasts.has(exit)) {
                exit.next.lasts.delete(exit);
            }
        }
    }

    buildBlocks(): void {
        const stmtQueue = [this.entry];
        const handledStmts: Set<StatementBuilder> = new Set();
        while (stmtQueue.length > 0) {
            let stmt = stmtQueue.pop()!;
            if (stmt.type.includes('exit')) {
                continue;
            }
            if (handledStmts.has(stmt)) {
                continue;
            }
            const block = new Block(this.blocks.length, []);
            this.blocks.push(block);
            while (stmt && !handledStmts.has(stmt)) {
                if (stmt.type === 'loopStatement' && block.stmts.length > 0 && !stmt.isDoWhile) {
                    stmtQueue.push(stmt);
                    break;
                }
                if (stmt.type.includes('Exit')) {
                    break;
                }
                block.stmts.push(stmt);
                stmt.block = block;
                handledStmts.add(stmt);
                if (stmt instanceof ConditionStatementBuilder) {
                    if (!handledStmts.has(stmt.nextF!)) {
                        stmtQueue.push(stmt.nextF!);
                    }
                    if (!handledStmts.has(stmt.nextT!)) {
                        stmtQueue.push(stmt.nextT!);
                    }
                    break;
                } else if (stmt instanceof SwitchStatementBuilder) {
                    for (let i = stmt.nexts.length - 1; i >= 0; i--) {
                        stmtQueue.push(stmt.nexts[i]);
                    }
                    break;
                } else if (stmt instanceof TryStatementBuilder) {
                    if (stmt.finallyStatement) {
                        stmtQueue.push(stmt.finallyStatement);
                    }
                    if (stmt.catchStatement) {
                        stmtQueue.push(stmt.catchStatement);
                    }
                    if (stmt.tryFirst) {
                        stmt = stmt.tryFirst;
                        continue;
                    }
                    break;
                } else {
                    if (stmt.next) {
                        if ((stmt.type === 'continueStatement' || stmt.next.type === 'loopStatement') && stmt.next.block) {
                            break;
                        }
                        if (stmt.next.type.includes('exit')) {
                            break;
                        }
                        stmt.next.passTmies++;
                        if (stmt.next.passTmies === stmt.next.lasts.size || (stmt.next.type === 'loopStatement') || stmt.next.isDoWhile) {
                            if (stmt.next.scopeID !== stmt.scopeID && !(stmt.next instanceof ConditionStatementBuilder && stmt.next.doStatement)
                                && !(ts.isCaseClause(stmt.astNode!) || ts.isDefaultClause(stmt.astNode!))) {
                                stmtQueue.push(stmt.next);
                                break;
                            }
                            stmt = stmt.next;
                        }
                    }
                }
            }
        }
    }

    buildBlocksNextLast() {
        for (let block of this.blocks) {
            for (let originStatement of block.stmts) {
                let lastStatement = (block.stmts.indexOf(originStatement) === block.stmts.length - 1);
                if (originStatement instanceof ConditionStatementBuilder) {
                    let nextT = originStatement.nextT?.block;
                    if (nextT && (lastStatement || nextT !== block) && !originStatement.nextT?.type.includes(' exit')) {
                        block.nexts.push(nextT);
                        nextT.lasts.push(block);
                    }
                    let nextF = originStatement.nextF?.block;
                    if (nextF && (lastStatement || nextF !== block) && !originStatement.nextF?.type.includes(' exit')) {
                        block.nexts.push(nextF);
                        nextF.lasts.push(block);
                    }
                } else if (originStatement instanceof SwitchStatementBuilder) {
                    for (const next of originStatement.nexts) {
                        const nextBlock = next.block;
                        if (nextBlock && (lastStatement || nextBlock !== block)) {
                            block.nexts.push(nextBlock);
                            nextBlock.lasts.push(block);
                        }
                    }
                } else {
                    let next = originStatement.next?.block;
                    if (next && (lastStatement || next !== block) && !originStatement.next?.type.includes(' exit')) {
                        block.nexts.push(next);
                        next.lasts.push(block);
                    }
                }

            }
        }
    }

    addReturnBlock() {
        let notReturnStmts: StatementBuilder[] = [];
        for (let stmt of [...this.exit.lasts]) {
            if (stmt.type !== 'returnStatement') {
                notReturnStmts.push(stmt);
            }
        }
        if (notReturnStmts.length < 1) {
            return;
        }
        const returnStatement = new StatementBuilder('returnStatement', 'return;', null, this.exit.scopeID);
        let tryExit = false;
        if (notReturnStmts.length === 1 && notReturnStmts[0].block) {
            for (const stmt of notReturnStmts[0].block.stmts) {
                if (stmt instanceof TryStatementBuilder) {
                    tryExit = true;
                    break;
                }
            }
        }
        if (notReturnStmts.length === 1 && !(notReturnStmts[0] instanceof ConditionStatementBuilder) && !tryExit) {
            const notReturnStmt = notReturnStmts[0];
            notReturnStmt.next = returnStatement;
            returnStatement.lasts = new Set([notReturnStmt]);
            returnStatement.next = this.exit;
            const lasts = [...this.exit.lasts];
            lasts[lasts.indexOf(notReturnStmt)] = returnStatement;
            this.exit.lasts = new Set(lasts);
            notReturnStmt.block?.stmts.push(returnStatement);
            returnStatement.block = notReturnStmt.block;
        } else {
            let returnBlock = new Block(this.blocks.length, [returnStatement]);
            returnStatement.block = returnBlock;
            this.blocks.push(returnBlock);
            for (const notReturnStmt of notReturnStmts) {
                if (notReturnStmt instanceof ConditionStatementBuilder) {
                    if (this.exit === notReturnStmt.nextT) {
                        notReturnStmt.nextT = returnStatement;
                        notReturnStmt.block?.nexts.splice(0, 0, returnBlock);
                    } else if (this.exit === notReturnStmt.nextF) {
                        notReturnStmt.nextF = returnStatement;
                        notReturnStmt.block?.nexts.push(returnBlock);
                    }
                } else {
                    notReturnStmt.next = returnStatement;
                    notReturnStmt.block?.nexts.push(returnBlock);
                }
                returnStatement.lasts.add(notReturnStmt);
                returnStatement.next = this.exit;
                const lasts = [...this.exit.lasts];
                lasts[lasts.indexOf(notReturnStmt)] = returnStatement;
                this.exit.lasts = new Set(lasts);
                returnBlock.lasts.push(notReturnStmt.block!);
            }
        }
    }

    resetWalked() {
        for (let stmt of this.statementArray) {
            stmt.walked = false;
        }
    }

    addStmtBuilderPosition() {
        for (const stmt of this.statementArray) {
            if (stmt.astNode) {
                const { line, character } = ts.getLineAndCharacterOfPosition(
                    this.sourceFile,
                    stmt.astNode.getStart(this.sourceFile),
                );
                stmt.line = line + 1;
                stmt.column = character + 1;
            }
        }
    }

    CfgBuilder2Array(stmt: StatementBuilder) {

        if (stmt.walked)
            return;
        stmt.walked = true;
        stmt.index = this.statementArray.length;
        if (!stmt.type.includes(' exit'))
            this.statementArray.push(stmt);
        if (stmt.type === 'ifStatement' || stmt.type === 'loopStatement' || stmt.type === 'catchOrNot') {
            let cstm = stmt as ConditionStatementBuilder;
            if (cstm.nextT == null || cstm.nextF == null) {
                this.errorTest(cstm);
                return;
            }
            this.CfgBuilder2Array(cstm.nextF);
            this.CfgBuilder2Array(cstm.nextT);
        } else if (stmt.type === 'switchStatement') {
            let sstm = stmt as SwitchStatementBuilder;
            for (let ss of sstm.nexts) {
                this.CfgBuilder2Array(ss);
            }
        } else if (stmt.type === 'tryStatement') {
            let trystm = stmt as TryStatementBuilder;
            if (trystm.tryFirst) {
                this.CfgBuilder2Array(trystm.tryFirst);
            }
            if (trystm.catchStatement) {
                this.CfgBuilder2Array(trystm.catchStatement);
            }
            if (trystm.finallyStatement) {
                this.CfgBuilder2Array(trystm.finallyStatement);
            }
            if (trystm.next) {
                this.CfgBuilder2Array(trystm.next);
            }
        } else {
            if (stmt.next != null)
                this.CfgBuilder2Array(stmt.next);
        }
    }

    getDotEdges(stmt: StatementBuilder) {
        if (this.statementArray.length === 0)
            this.CfgBuilder2Array(this.entry);
        if (stmt.walked)
            return;
        stmt.walked = true;
        if (stmt.type === 'ifStatement' || stmt.type === 'loopStatement' || stmt.type === 'catchOrNot') {
            let cstm = stmt as ConditionStatementBuilder;
            if (cstm.nextT == null || cstm.nextF == null) {
                this.errorTest(cstm);
                return;
            }
            let edge = [cstm.index, cstm.nextF.index];
            this.dotEdges.push(edge);
            edge = [cstm.index, cstm.nextT.index];
            this.dotEdges.push(edge);
            this.getDotEdges(cstm.nextF);
            this.getDotEdges(cstm.nextT);
        } else if (stmt.type === 'switchStatement') {
            let sstm = stmt as SwitchStatementBuilder;
            for (let ss of sstm.nexts) {
                let edge = [sstm.index, ss.index];
                this.dotEdges.push(edge);
                this.getDotEdges(ss);
            }
        } else {
            if (stmt.next != null) {
                let edge = [stmt.index, stmt.next.index];
                this.dotEdges.push(edge);
                this.getDotEdges(stmt.next);
            }
        }
    }

    errorTest(stmt: StatementBuilder) {
        let mes = 'ifnext error    ';
        if (this.declaringClass?.getDeclaringArkFile()) {
            mes += this.declaringClass?.getDeclaringArkFile().getName() + '.' + this.declaringClass.getName() + '.' + this.name;
        }
        mes += '\n' + stmt.code;
        throw new textError(mes);
    }

    printBlocks(): string {
        let text = '';
        if (this.declaringClass?.getDeclaringArkFile()) {
            text += this.declaringClass.getDeclaringArkFile().getName() + '\n';
        }
        for (let bi = 0; bi < this.blocks.length; bi++) {
            let block = this.blocks[bi];
            if (bi !== 0)
                text += 'label' + block.id + ':\n';
            let length = block.stmts.length;
            for (let i = 0; i < length; i++) {
                let stmt = block.stmts[i];
                if (stmt.type === 'ifStatement' || stmt.type === 'loopStatement' || stmt.type === 'catchOrNot') {
                    let cstm = stmt as ConditionStatementBuilder;
                    if (cstm.nextT == null || cstm.nextF == null) {
                        this.errorTest(cstm);
                        return text;
                    }
                    if (!cstm.nextF.block || !cstm.nextT.block) {
                        this.errorTest(cstm);
                        return text;
                    }
                    stmt.code = 'if !(' + cstm.condition + ') goto label' + cstm.nextF.block.id;
                    if (i === length - 1 && bi + 1 < this.blocks.length && this.blocks[bi + 1].id !== cstm.nextT.block.id) {
                        let gotoStm = new StatementBuilder('gotoStatement', 'goto label' + cstm.nextT.block.id, null, block.stmts[0].scopeID);
                        block.stmts.push(gotoStm);
                        length++;
                    }
                } else if (stmt.type === 'breakStatement' || stmt.type === 'continueStatement') {
                    if (!stmt.next?.block) {
                        this.errorTest(stmt);
                        return text;
                    }
                    stmt.code = 'goto label' + stmt.next?.block.id;
                } else {
                    if (i === length - 1 && stmt.next?.block && (bi + 1 < this.blocks.length && this.blocks[bi + 1].id !== stmt.next.block.id || bi + 1 === this.blocks.length)) {
                        let gotoStm = new StatementBuilder('StatementBuilder', 'goto label' + stmt.next?.block.id, null, block.stmts[0].scopeID);
                        block.stmts.push(gotoStm);
                        length++;
                    }
                }
                if (stmt.addressCode3.length === 0) {
                    text += '    ' + stmt.code + '\n';
                } else {
                    for (let ac of stmt.addressCode3) {
                        if (ac.startsWith('if') || ac.startsWith('while')) {
                            let cstm = stmt as ConditionStatementBuilder;
                            let condition = ac.substring(ac.indexOf('('));
                            let goto = '';
                            if (cstm.nextF?.block)
                                goto = 'if !' + condition + ' goto label' + cstm.nextF?.block.id;
                            stmt.addressCode3[stmt.addressCode3.indexOf(ac)] = goto;
                            text += '    ' + goto + '\n';
                        } else
                            text += '    ' + ac + '\n';
                    }
                }
            }

        }
        for (let cat of this.catches) {
            text += 'catch ' + cat.errorName + ' from label ' + cat.from + ' to label ' + cat.to + ' with label' + cat.withLabel + '\n';
        }

        return text;
    }

    buildStatementBuilder4ArrowFunction(stmt: ts.Node) {
        let s = new StatementBuilder('statement', stmt.getText(this.sourceFile), stmt, 0);
        this.entry.next = s;
        s.lasts = new Set([this.entry]);
        s.next = this.exit;
        this.exit.lasts = new Set([s]);
    }

    buildCfgBuilder() {
        let stmts: ts.Node[] = [];
        if (ts.isSourceFile(this.astRoot)) {
            stmts = [...this.astRoot.statements];
        } else if (ts.isFunctionDeclaration(this.astRoot) || ts.isMethodDeclaration(this.astRoot) || ts.isConstructorDeclaration(this.astRoot)
            || ts.isGetAccessorDeclaration(this.astRoot) || ts.isSetAccessorDeclaration(this.astRoot) || ts.isFunctionExpression(this.astRoot)) {
            if (this.astRoot.body) {
                stmts = [...this.astRoot.body.statements];
            } else {
                this.emptyBody = true;
            }
        } else if (ts.isArrowFunction(this.astRoot)) {
            if (ts.isBlock(this.astRoot.body)) {
                stmts = [...this.astRoot.body.statements];
            }
        } else if (ts.isMethodSignature(this.astRoot) || ts.isConstructSignatureDeclaration(this.astRoot)
            || ts.isCallSignatureDeclaration(this.astRoot) || ts.isFunctionTypeNode(this.astRoot)) {
            this.emptyBody = true;
        } else if (ts.isModuleDeclaration(this.astRoot) && ts.isModuleBlock(this.astRoot.body!)) {
            stmts = [...this.astRoot.body.statements];
        }
        if (!ModelUtils.isArkUIBuilderMethod(this.declaringMethod)) {
            this.walkAST(this.entry, this.exit, stmts);
        } else {
            this.handleBuilder(stmts);
        }
        if (ts.isArrowFunction(this.astRoot) && !ts.isBlock(this.astRoot.body)) {
            this.buildStatementBuilder4ArrowFunction(this.astRoot.body);
        }
        this.addReturnInEmptyMethod();
        this.deleteExit();
        this.CfgBuilder2Array(this.entry);
        this.addStmtBuilderPosition();
        this.buildBlocks();
        this.blocks = this.blocks.filter((b) => b.stmts.length !== 0);
        this.buildBlocksNextLast();
        this.addReturnBlock();
    }

    private handleBuilder(stmts: ts.Node[]): void {
        let lastStmt = this.entry;
        for (const stmt of stmts) {
            const stmtBuilder = new StatementBuilder('statement', stmt.getText(this.sourceFile), stmt, 0);
            lastStmt.next = stmtBuilder;
            stmtBuilder.lasts.add(lastStmt);
            lastStmt = stmtBuilder;
        }
        lastStmt.next = this.exit;
        this.exit.lasts.add(lastStmt);
    }

    public isBodyEmpty(): boolean {
        return this.emptyBody;
    }

    public buildCfgAndOriginalCfg(): {
        cfg: Cfg,
        locals: Set<Local>,
        aliasTypeMap: Map<string, [AliasType, AliasTypeDeclaration]>
    } {
        if (ts.isArrowFunction(this.astRoot) && !ts.isBlock(this.astRoot.body)) {
            return this.buildCfgAndOriginalCfgForSimpleArrowFunction();
        }

        return this.buildNormalCfgAndOriginalCfg();
    }

    public buildCfgAndOriginalCfgForSimpleArrowFunction(): {
        cfg: Cfg,
        locals: Set<Local>,
        aliasTypeMap: Map<string, [AliasType, AliasTypeDeclaration]>
    } {
        const stmts: Stmt[] = [];
        const arkIRTransformer = new ArkIRTransformer(this.sourceFile, this.declaringMethod);
        stmts.push(...arkIRTransformer.prebuildStmts());
        const expressionBodyNode = (this.astRoot as ts.ArrowFunction).body as ts.Expression;
        const expressionBodyStmts: Stmt[] = [];
        let {
            value: expressionBodyValue,
            valueOriginalPositions: expressionBodyPositions,
            stmts: tempStmts,
        } = arkIRTransformer.tsNodeToValueAndStmts(expressionBodyNode);
        expressionBodyStmts.push(...tempStmts);
        if (IRUtils.moreThanOneAddress(expressionBodyValue)) {
            ({
                value: expressionBodyValue,
                valueOriginalPositions: expressionBodyPositions,
                stmts: tempStmts,
            } = arkIRTransformer.generateAssignStmtForValue(expressionBodyValue, expressionBodyPositions));
            expressionBodyStmts.push(...tempStmts);
        }
        const returnStmt = new ArkReturnStmt(expressionBodyValue);
        returnStmt.setOperandOriginalPositions([expressionBodyPositions[0], ...expressionBodyPositions]);
        expressionBodyStmts.push(returnStmt);
        arkIRTransformer.mapStmtsToTsStmt(expressionBodyStmts, expressionBodyNode);
        stmts.push(...expressionBodyStmts);
        const cfg = new Cfg();
        const blockInCfg = new BasicBlock();
        blockInCfg.setId(0);
        stmts.forEach(stmt => {
            blockInCfg.addStmt(stmt);
            stmt.setCfg(cfg);
        });
        cfg.addBlock(blockInCfg);
        cfg.setStartingStmt(stmts[0]);
        return {
            cfg: cfg,
            locals: arkIRTransformer.getLocals(),
            aliasTypeMap: arkIRTransformer.getAliasTypeMap()
        };
    }

    public buildNormalCfgAndOriginalCfg(): {
        cfg: Cfg,
        locals: Set<Local>,
        aliasTypeMap: Map<string, [AliasType, AliasTypeDeclaration]>
    } {
        const cfg = new Cfg();
        const blockBuilderToCfgBlock = new Map<Block, BasicBlock>();
        let isStartingStmtInCfgBlock = true;

        const arkIRTransformer = new ArkIRTransformer(this.sourceFile, this.declaringMethod);
        const blocksContainLoopCondition = new Set<Block>();
        for (let i = 0; i < this.blocks.length; i++) {
            // build block in Cfg
            const stmtsInBlock: Stmt[] = [];
            if (i === 0) {
                stmtsInBlock.push(...arkIRTransformer.prebuildStmts());
            }
            for (const statementBuilder of this.blocks[i].stmts) {
                if (statementBuilder.type === 'loopStatement') {
                    blocksContainLoopCondition.add(this.blocks[i]);
                }
                if (statementBuilder.astNode && statementBuilder.code !== '') {
                    stmtsInBlock.push(...arkIRTransformer.tsNodeToStmts(statementBuilder.astNode));
                } else if (statementBuilder.code.startsWith('return')) {
                    stmtsInBlock.push(new ArkReturnVoidStmt());
                }
            }
            const blockInCfg = new BasicBlock();
            blockInCfg.setId(this.blocks[i].id);
            for (const stmt of stmtsInBlock) {
                if (isStartingStmtInCfgBlock) {
                    isStartingStmtInCfgBlock = false;
                    cfg.setStartingStmt(stmt);
                }
                blockInCfg.addStmt(stmt);
            }
            cfg.addBlock(blockInCfg);
            blockBuilderToCfgBlock.set(this.blocks[i], blockInCfg);
        }
        let currBlockId = this.blocks.length;

        // link blocks
        for (const [blockBuilder, cfgBlock] of blockBuilderToCfgBlock) {
            for (const successorBlockBuilder of blockBuilder.nexts) {
                if (!blockBuilderToCfgBlock.get(successorBlockBuilder)) {
                    continue;
                }
                const successorBlock = blockBuilderToCfgBlock.get(successorBlockBuilder) as BasicBlock;
                cfgBlock.addSuccessorBlock(successorBlock);
            }
            for (const predecessorBlockBuilder of blockBuilder.lasts) {
                if (!blockBuilderToCfgBlock.get(predecessorBlockBuilder)) {
                    continue;
                }
                const predecessorBlock = blockBuilderToCfgBlock.get(predecessorBlockBuilder) as BasicBlock;
                cfgBlock.addPredecessorBlock(predecessorBlock);
            }
        }

        // put statements within loop in right position
        for (const blockBuilder of blocksContainLoopCondition) {
            if (!blockBuilderToCfgBlock.get(blockBuilder)) {
                continue;
            }
            const block = blockBuilderToCfgBlock.get(blockBuilder) as BasicBlock;
            const blockId = block.getId();
            const stmts = block.getStmts();
            const stmtsCnt = stmts.length;
            let ifStmtIdx = -1;
            let iteratorNextStmtIdx = -1;
            let dummyInitializerStmtIdx = -1;
            for (let i = 0; i < stmtsCnt; i++) {
                const stmt = stmts[i];
                if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof AbstractInvokeExpr) {
                    const invokeExpr = stmt.getRightOp() as AbstractInvokeExpr;
                    if (invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName() === Builtin.ITERATOR_NEXT) {
                        iteratorNextStmtIdx = i;
                        continue;
                    }
                }
                if (stmt.toString() === DUMMY_INITIALIZER_STMT) {
                    dummyInitializerStmtIdx = i;
                    continue;
                }
                if (stmt instanceof ArkIfStmt) {
                    ifStmtIdx = i;
                    break;
                }
            }

            if (iteratorNextStmtIdx !== -1 || dummyInitializerStmtIdx !== -1) {
                // put statements into block before condition
                const lastStmtIdxBeforeCondition = iteratorNextStmtIdx !== -1 ? iteratorNextStmtIdx : dummyInitializerStmtIdx;
                const stmtsInsertBeforeCondition = stmts.slice(0, lastStmtIdxBeforeCondition);

                let prevBlockBuilderContainsLoop = false;
                for (const prevBlockBuilder of blockBuilder.lasts) {
                    if (prevBlockBuilder.id < blockId && blocksContainLoopCondition.has(prevBlockBuilder)) {
                        prevBlockBuilderContainsLoop = true;
                        break;
                    }
                }

                if (prevBlockBuilderContainsLoop) {
                    // should create an extra block when previous block contains loop condition
                    this.insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock, blockBuilder, stmtsInsertBeforeCondition, false, cfg);
                } else {
                    const blockBuilderBeforeCondition = blockBuilder.lasts[0];
                    const blockBeforeCondition = blockBuilderToCfgBlock.get(blockBuilderBeforeCondition) as BasicBlock;
                    blockBeforeCondition?.getStmts().push(...stmtsInsertBeforeCondition);
                }

                if (dummyInitializerStmtIdx !== -1 && ifStmtIdx !== stmtsCnt - 1) {
                    // put incrementor statements into block which reenters condition
                    const stmtsReenterCondition = stmts.slice(ifStmtIdx + 1);
                    const blockBuildersReenterCondition: Block[] = [];
                    for (const prevBlockBuilder of blockBuilder.lasts) {
                        const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder) as BasicBlock;
                        if (prevBlock.getId() > blockId) {
                            blockBuildersReenterCondition.push(prevBlockBuilder);
                        }
                    }

                    if (blockBuildersReenterCondition.length > 1 || blocksContainLoopCondition.has(blockBuildersReenterCondition[0])) {
                        // put incrementor statements into an extra block
                        this.insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock, blockBuilder, stmtsReenterCondition, true, cfg);
                    } else {
                        // put incrementor statements into prev reenter block
                        const blockReenterCondition = blockBuilderToCfgBlock.get(blockBuildersReenterCondition[0]) as BasicBlock;
                        blockReenterCondition?.getStmts().push(...stmtsReenterCondition);
                    }
                } else if (iteratorNextStmtIdx !== -1) {
                    // put statements which get value of iterator into block after condition
                    const blockBuilderAfterCondition = blockBuilder.nexts[0];
                    const blockAfterCondition = blockBuilderToCfgBlock.get(blockBuilderAfterCondition) as BasicBlock;

                    const stmtsAfterCondition = stmts.slice(ifStmtIdx + 1);
                    blockAfterCondition?.getStmts().splice(0, 0, ...stmtsAfterCondition);
                }

                // remove statements which should not in condition
                const firstStmtIdxInCondition = iteratorNextStmtIdx !== -1 ? iteratorNextStmtIdx : dummyInitializerStmtIdx + 1;
                stmts.splice(0, firstStmtIdxInCondition);
                stmts.splice(ifStmtIdx - firstStmtIdxInCondition + 1);
            }
        }

        for (const blockBuilder of this.blocks) {
            if (blockBuilder.id === -1) {
                blockBuilder.id = currBlockId++;
                const block = blockBuilderToCfgBlock.get(blockBuilder) as BasicBlock;
                block.setId(blockBuilder.id);
            }
        }
        for (const stmt of cfg.getStmts()) {
            stmt.setCfg(cfg);
        }

        return {
            cfg: cfg,
            locals: arkIRTransformer.getLocals(),
            aliasTypeMap: arkIRTransformer.getAliasTypeMap(),
        };
    }

    private insertBeforeConditionBlockBuilder(blockBuilderToCfgBlock: Map<Block, BasicBlock>,
        conditionBlockBuilder: Block,
        stmtsInsertBeforeCondition: Stmt[],
        collectReenter: Boolean,
        cfg: Cfg): void {
        const blockId = conditionBlockBuilder.id;
        const block = blockBuilderToCfgBlock.get(conditionBlockBuilder) as BasicBlock;
        const blockBuildersBeforeCondition: Block[] = [];
        const blocksBeforeCondition: BasicBlock[] = [];
        const blockBuildersReenterCondition: Block[] = [];
        const blocksReenterCondition: BasicBlock[] = [];
        for (const prevBlockBuilder of conditionBlockBuilder.lasts) {
            const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder) as BasicBlock;
            if (prevBlock.getId() < blockId) {
                blockBuildersBeforeCondition.push(prevBlockBuilder);
                blocksBeforeCondition.push(prevBlock);
            } else {
                blockBuildersReenterCondition.push(prevBlockBuilder);
                blocksReenterCondition.push(prevBlock);
            }
        }

        let collectedBlockBuilders: Block[] = [];
        let collectedBlocks: BasicBlock[] = [];
        if (collectReenter) {
            collectedBlockBuilders = blockBuildersReenterCondition;
            collectedBlocks = blocksReenterCondition;
        } else {
            collectedBlockBuilders = blockBuildersBeforeCondition;
            collectedBlocks = blocksBeforeCondition;
        }

        const blockBuilderInsertBeforeCondition = new Block(-1, []);
        blockBuilderInsertBeforeCondition.lasts.push(...collectedBlockBuilders);
        blockBuilderInsertBeforeCondition.nexts.push(conditionBlockBuilder);
        const blockInsertBeforeCondition = new BasicBlock();
        blockInsertBeforeCondition.getStmts().push(...stmtsInsertBeforeCondition);
        blockInsertBeforeCondition.getPredecessors().push(...collectedBlocks);
        blockInsertBeforeCondition.addSuccessorBlock(block);

        for (const prevBlockBuilder of collectedBlockBuilders) {
            const prevBlock = blockBuilderToCfgBlock.get(prevBlockBuilder) as BasicBlock;
            for (let j = 0; j < prevBlockBuilder.nexts.length; j++) {
                if (prevBlockBuilder.nexts[j] === conditionBlockBuilder) {
                    prevBlockBuilder.nexts[j] = blockBuilderInsertBeforeCondition;
                    prevBlock.setSuccessorBlock(j, blockInsertBeforeCondition);
                    break;
                }
            }
        }

        let newPrevBlockBuildersBeforeCondition: Block[] = [];
        let newPrevBlocksBeforeCondition: BasicBlock[] = [];
        if (collectReenter) {
            newPrevBlockBuildersBeforeCondition = [...blockBuildersBeforeCondition, blockBuilderInsertBeforeCondition];
            newPrevBlocksBeforeCondition = [...blocksBeforeCondition, blockInsertBeforeCondition];
        } else {
            newPrevBlockBuildersBeforeCondition = [blockBuilderInsertBeforeCondition, ...blockBuildersReenterCondition];
            newPrevBlocksBeforeCondition = [blockInsertBeforeCondition, ...blocksReenterCondition];
        }

        conditionBlockBuilder.lasts = newPrevBlockBuildersBeforeCondition;
        const predecessorsCnt = block.getPredecessors().length;
        block.getPredecessors().splice(0, predecessorsCnt, ...newPrevBlocksBeforeCondition);

        this.blocks.push(blockBuilderInsertBeforeCondition);
        cfg.addBlock(blockInsertBeforeCondition);
        blockBuilderToCfgBlock.set(blockBuilderInsertBeforeCondition, blockInsertBeforeCondition);
    }
}