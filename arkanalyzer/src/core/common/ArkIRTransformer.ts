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

import {
    AbstractBinopExpr,
    AbstractExpr,
    AbstractInvokeExpr,
    ArkAwaitExpr,
    ArkCastExpr,
    ArkConditionExpr,
    ArkDeleteExpr,
    ArkInstanceInvokeExpr,
    ArkInstanceOfExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkNormalBinopExpr,
    ArkPtrInvokeExpr,
    ArkStaticInvokeExpr,
    ArkTypeOfExpr,
    ArkUnopExpr,
    ArkYieldExpr,
    BinaryOperator,
    NormalBinaryOperator,
    RelationalBinaryOperator,
    UnaryOperator,
} from '../base/Expr';
import {
    AbstractFieldRef,
    ArkArrayRef,
    ArkCaughtExceptionRef,
    ArkInstanceFieldRef,
    ArkParameterRef,
    ArkStaticFieldRef,
    ArkThisRef,
} from '../base/Ref';
import { Value } from '../base/Value';
import * as ts from 'ohos-typescript';
import { Local } from '../base/Local';
import {
    ArkAssignStmt,
    ArkIfStmt,
    ArkInvokeStmt,
    ArkReturnStmt,
    ArkReturnVoidStmt,
    ArkThrowStmt,
    Stmt,
} from '../base/Stmt';
import {
    AliasType,
    AliasTypeDeclaration,
    AnyType,
    ArrayType,
    BooleanType,
    ClassType,
    FunctionType,
    LiteralType,
    NeverType,
    NullType,
    NumberType,
    StringType,
    TupleType,
    Type,
    UnclearReferenceType,
    UndefinedType,
    UnionType,
    UnknownType,
    VoidType,
} from '../base/Type';
import { Constant } from '../base/Constant';
import { ValueUtil } from './ValueUtil';
import {
    ClassSignature,
    FieldSignature,
    LocalSignature,
    MethodSignature,
    MethodSubSignature,
} from '../model/ArkSignature';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { IRUtils } from './IRUtils';
import { ArkMethod } from '../model/ArkMethod';
import { buildArkMethodFromArkClass } from '../model/builder/ArkMethodBuilder';
import { buildNormalArkClassFromArkFile, buildNormalArkClassFromArkNamespace } from '../model/builder/ArkClassBuilder';
import { ArkClass } from '../model/ArkClass';
import { ArkSignatureBuilder } from '../model/builder/ArkSignatureBuilder';
import {
    COMPONENT_BRANCH_FUNCTION,
    COMPONENT_CREATE_FUNCTION,
    COMPONENT_CUSTOMVIEW, COMPONENT_FOR_EACH,
    COMPONENT_IF, COMPONENT_LAZY_FOR_EACH,
    COMPONENT_POP_FUNCTION,
    COMPONENT_REPEAT,
    isEtsSystemComponent,
} from './EtsConst';
import { FullPosition, LineColPosition } from '../base/Position';
import { ModelUtils } from './ModelUtils';
import { Builtin } from './Builtin';
import { CONSTRUCTOR_NAME, THIS_NAME } from './TSConst';
import { buildModifiers } from '../model/builder/builderUtils';
import { TEMP_LOCAL_PREFIX } from './Const';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'ArkIRTransformer');

export const DUMMY_INITIALIZER_STMT = 'dummyInitializerStmt';

type ValueAndStmts = {
    value: Value,
    valueOriginalPositions: FullPosition[], // original positions of value and its uses
    stmts: Stmt[]
};

export class DummyStmt extends Stmt {
    constructor(text: string) {
        super();
        this.text = text;
    }

    public toString(): string {
        return this.text!;
    }
}

export class ArkIRTransformer {
    private tempLocalIndex: number = 0;
    private locals: Map<string, Local> = new Map();
    private sourceFile: ts.SourceFile;
    private declaringMethod: ArkMethod;
    private thisLocal: Local;

    private inBuilderMethod = false;
    private aliasTypeMap: Map<string, [AliasType, AliasTypeDeclaration]> = new Map();
    private stmtsHaveOriginalText: Set<Stmt> = new Set();

    private builderMethodContextFlag = false;

    constructor(sourceFile: ts.SourceFile, declaringMethod: ArkMethod) {
        this.sourceFile = sourceFile;
        this.declaringMethod = declaringMethod;
        this.thisLocal = new Local(THIS_NAME, declaringMethod.getDeclaringArkClass().getSignature().getType());
        this.locals.set(this.thisLocal.getName(), this.thisLocal);
        this.inBuilderMethod = ModelUtils.isArkUIBuilderMethod(declaringMethod);
    }

    public getLocals(): Set<Local> {
        return new Set<Local>(this.locals.values());
    }

    public getThisLocal(): Local {
        return this.thisLocal;
    }

    public getAliasTypeMap(): Map<string, [AliasType, AliasTypeDeclaration]> {
        return this.aliasTypeMap;
    }

    public prebuildStmts(): Stmt[] {
        const stmts: Stmt[] = [];
        let index = 0;
        for (const methodParameter of this.declaringMethod.getParameters()) {
            const parameterRef = new ArkParameterRef(index, methodParameter.getType());
            stmts.push(new ArkAssignStmt(this.getOrCreatLocal(methodParameter.getName(), parameterRef.getType()), parameterRef));
            index++;
        }

        const thisRef = new ArkThisRef(this.getThisLocal().getType() as ClassType);
        stmts.push(new ArkAssignStmt(this.getThisLocal(), thisRef));
        return stmts;
    }

    public tsNodeToStmts(node: ts.Node): Stmt[] {
        let stmts: Stmt[] = [];
        if (ts.isExpressionStatement(node)) {
            stmts = this.expressionStatementToStmts(node);
        } else if (ts.isTypeAliasDeclaration(node)) {
            stmts = this.typeAliasDeclarationToStmts(node);
        } else if (ts.isBlock(node)) {
            stmts = this.blockToStmts(node);
        } else if (ts.isSwitchStatement(node)) {
            stmts = this.switchStatementToStmts(node);
        } else if (ts.isForStatement(node)) {
            stmts = this.forStatementToStmts(node);
        } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
            stmts = this.rangeForStatementToStmts(node);
        } else if (ts.isWhileStatement(node)) {
            stmts = this.whileStatementToStmts(node);
        } else if (ts.isDoStatement(node)) {
            stmts = this.doStatementToStmts(node);
        } else if (ts.isVariableStatement(node)) {
            stmts = this.variableStatementToStmts(node);
        } else if (ts.isVariableDeclarationList(node)) {
            stmts = this.variableDeclarationListToStmts(node);
        } else if (ts.isIfStatement(node)) {
            stmts = this.ifStatementToStmts(node);
        } else if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
            stmts = this.gotoStatementToStmts(node);
        } else if (ts.isThrowStatement(node)) {
            stmts = this.throwStatementToStmts(node);
        } else if (ts.isCatchClause(node)) {
            stmts = this.catchClauseToStmts(node);
        } else if (ts.isReturnStatement(node)) {
            stmts = this.returnStatementToStmts(node);
        } else if (ts.isFunctionDeclaration(node)) {
            stmts = this.functionDeclarationToStmts(node);
        }

        this.mapStmtsToTsStmt(stmts, node);
        if (stmts.length > 0) {
            IRUtils.setLeadingComments(stmts[0], node, this.sourceFile, this.declaringMethod.getDeclaringArkFile().getScene().getOptions());
        }
        return stmts;
    }

    private functionDeclarationToStmts(functionDeclarationNode: ts.FunctionDeclaration): Stmt[] {
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const arkMethod = new ArkMethod();
        if (this.builderMethodContextFlag) {
            ModelUtils.implicitArkUIBuilderMethods.add(arkMethod);
        }
        buildArkMethodFromArkClass(functionDeclarationNode, declaringClass, arkMethod, this.sourceFile, this.declaringMethod);
        return [];
    }

    private returnStatementToStmts(returnStatement: ts.ReturnStatement): Stmt[] {
        const stmts: Stmt[] = [];
        if (returnStatement.expression) {
            let {
                value: exprValue,
                valueOriginalPositions: exprPositions,
                stmts: exprStmts,
            } = this.tsNodeToValueAndStmts(returnStatement.expression);
            stmts.push(...exprStmts);
            if (IRUtils.moreThanOneAddress(exprValue)) {
                ({
                    value: exprValue,
                    valueOriginalPositions: exprPositions,
                    stmts: exprStmts,
                } = this.generateAssignStmtForValue(exprValue, exprPositions));
                stmts.push(...exprStmts);
            }
            const returnStmt = new ArkReturnStmt(exprValue);
            returnStmt.setOperandOriginalPositions(exprPositions);
            stmts.push(returnStmt);
        } else {
            stmts.push(new ArkReturnVoidStmt());
        }
        return stmts;
    }

    private blockToStmts(block: ts.Block): Stmt[] {
        const stmts: Stmt[] = [];
        for (const statement of block.statements) {
            stmts.push(...this.tsNodeToStmts(statement));
        }
        return stmts;
    }

    private expressionStatementToStmts(expressionStatement: ts.ExpressionStatement): Stmt[] {
        return this.expressionToStmts(expressionStatement.expression);
    }

    private expressionToStmts(expression: ts.Expression): Stmt[] {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: stmts } = this.tsNodeToValueAndStmts(
            expression);
        if (exprValue instanceof AbstractInvokeExpr) {
            const invokeStmt = new ArkInvokeStmt(exprValue);
            invokeStmt.setOperandOriginalPositions(exprPositions);
            stmts.push(invokeStmt);

            let hasRepeat: boolean = false;
            for (const stmt of stmts) {
                if ((stmt instanceof ArkAssignStmt) && (stmt.getRightOp() instanceof ArkStaticInvokeExpr)) {
                    const rightOp = stmt.getRightOp() as ArkStaticInvokeExpr;
                    if (rightOp.getMethodSignature().getMethodSubSignature().getMethodName() === COMPONENT_REPEAT) {
                        const createMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_REPEAT, COMPONENT_CREATE_FUNCTION);
                        const createInvokeExpr = new ArkStaticInvokeExpr(createMethodSignature, rightOp.getArgs());
                        stmt.setRightOp(createInvokeExpr);
                        hasRepeat = true;
                    }
                }
            }
            if (hasRepeat) {
                const popMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_REPEAT, COMPONENT_POP_FUNCTION);
                const popInvokeExpr = new ArkStaticInvokeExpr(popMethodSignature, []);
                const popInvokeStmt = new ArkInvokeStmt(popInvokeExpr);
                stmts.push(popInvokeStmt);
            }
        } else if (exprValue instanceof AbstractExpr) {
            const { stmts: exprStmts } = this.generateAssignStmtForValue(exprValue, exprPositions);
            stmts.push(...exprStmts);
        }
        return stmts;
    }

    private typeAliasDeclarationToStmts(typeAliasDeclaration: ts.TypeAliasDeclaration): Stmt[] {
        const aliasName = typeAliasDeclaration.name.text;
        const originalType = this.resolveTypeNode(typeAliasDeclaration.type);
        const aliasType = new AliasType(aliasName, originalType,
            new LocalSignature(aliasName, this.declaringMethod.getSignature()));
        const modifiers = typeAliasDeclaration.modifiers ? buildModifiers(typeAliasDeclaration) : 0;
        aliasType.setModifiers(modifiers);
        const sourceCode = typeAliasDeclaration.getText(this.sourceFile);
        const aliasTypePosition = LineColPosition.buildFromNode(typeAliasDeclaration, this.sourceFile);
        const aliasTypeDeclaration = new AliasTypeDeclaration(sourceCode, aliasTypePosition)
            this.aliasTypeMap.set(aliasName, [aliasType, aliasTypeDeclaration]);
        return [];
    }

    private switchStatementToStmts(switchStatement: ts.SwitchStatement): Stmt[] {
        const stmts: Stmt[] = [];
        let {
            value: exprValue,
            valueOriginalPositions: exprPositions,
            stmts: exprStmts,
        } = this.tsNodeToValueAndStmts(switchStatement.expression);
        stmts.push(...exprStmts);
        if (IRUtils.moreThanOneAddress(exprValue)) {
            const { value: newExprValue, stmts: exprStmts } = this.generateAssignStmtForValue(exprValue, exprPositions);
            stmts.push(...exprStmts);
            exprValue = newExprValue;
        }
        const caseValues: Value[] = [];
        for (const clause of switchStatement.caseBlock.clauses) {
            if (ts.isCaseClause(clause)) {
                let {
                    value: clauseValue,
                    valueOriginalPositions: clausePositions,
                    stmts: clauseStmts,
                } = this.tsNodeToValueAndStmts(switchStatement.expression);
                stmts.push(...clauseStmts);
                if (IRUtils.moreThanOneAddress(clauseValue)) {
                    const {
                        value: newClauseValue,
                        stmts: clauseStmts,
                    } = this.generateAssignStmtForValue(exprValue, clausePositions);
                    stmts.push(...clauseStmts);
                    clauseValue = newClauseValue;
                }
                caseValues.push(clauseValue);
            }
        }
        return stmts;
    }

    private forStatementToStmts(forStatement: ts.ForStatement): Stmt[] {
        const stmts: Stmt[] = [];
        if (forStatement.initializer) {
            stmts.push(...this.tsNodeToValueAndStmts(forStatement.initializer).stmts);
        }
        const dummyInitializerStmt = new DummyStmt(DUMMY_INITIALIZER_STMT);
        stmts.push(dummyInitializerStmt);

        if (forStatement.condition) {
            const {
                value: conditionValue,
                stmts: conditionStmts,
            } = this.conditionToValueAndStmts(forStatement.condition);
            stmts.push(...conditionStmts);
            stmts.push(new ArkIfStmt(conditionValue as ArkConditionExpr));
        }
        if (forStatement.incrementor) {
            stmts.push(...this.tsNodeToValueAndStmts(forStatement.incrementor).stmts);
        }
        return stmts;
    }

    private rangeForStatementToStmts(forOfStatement: ts.ForOfStatement | ts.ForInStatement): Stmt[] {
        const stmts: Stmt[] = [];
        let {
            value: iterableValue,
            valueOriginalPositions: iterablePositions,
            stmts: iterableStmts,
        } = this.tsNodeToValueAndStmts(forOfStatement.expression);
        stmts.push(...iterableStmts);
        if (!(iterableValue instanceof Local)) {
            ({ value: iterableValue, valueOriginalPositions: iterablePositions, stmts: iterableStmts } =
                this.generateAssignStmtForValue(iterableValue, iterablePositions));
            stmts.push(...iterableStmts);
        }
        const iteratorMethodSubSignature = new MethodSubSignature(Builtin.ITERATOR_FUNCTION, [],
            Builtin.ITERATOR_CLASS_TYPE);
        const iteratorMethodSignature = new MethodSignature(ClassSignature.DEFAULT, iteratorMethodSubSignature);
        const iteratorInvokeExpr = new ArkInstanceInvokeExpr(iterableValue as Local, iteratorMethodSignature, []);
        const iteratorInvokeExprPositions = [iterablePositions[0], ...iterablePositions];
        const {
            value: iterator,
            valueOriginalPositions: iteratorPositions,
            stmts: iteratorStmts,
        } = this.generateAssignStmtForValue(iteratorInvokeExpr, iteratorInvokeExprPositions);
        stmts.push(...iteratorStmts);
        (iterator as Local).setType(Builtin.ITERATOR_CLASS_TYPE);

        const nextMethodSubSignature = new MethodSubSignature(Builtin.ITERATOR_NEXT, [],
            Builtin.ITERATOR_RESULT_CLASS_TYPE);
        const nextMethodSignature = new MethodSignature(ClassSignature.DEFAULT, nextMethodSubSignature);
        const iteratorNextInvokeExpr = new ArkInstanceInvokeExpr(iterator as Local, nextMethodSignature, []);
        const iteratorNextInvokeExprPositions = [iteratorPositions[0], ...iteratorPositions];
        const {
            value: iteratorResult,
            valueOriginalPositions: iteratorResultPositions,
            stmts: iteratorResultStmts,
        } = this.generateAssignStmtForValue(iteratorNextInvokeExpr, iteratorNextInvokeExprPositions);
        stmts.push(...iteratorResultStmts);
        (iteratorResult as Local).setType(Builtin.ITERATOR_RESULT_CLASS_TYPE);
        const doneFieldSignature = new FieldSignature(Builtin.ITERATOR_RESULT_DONE,
            Builtin.ITERATOR_RESULT_CLASS_SIGNATURE, BooleanType.getInstance(), false);
        const doneFieldRef = new ArkInstanceFieldRef(iteratorResult as Local, doneFieldSignature);
        const doneFieldRefPositions = [iteratorResultPositions[0], ...iteratorResultPositions];
        const {
            value: doneFlag,
            valueOriginalPositions: doneFlagPositions,
            stmts: doneFlagStmts,
        } = this.generateAssignStmtForValue(doneFieldRef, doneFieldRefPositions);
        stmts.push(...doneFlagStmts);
        (doneFlag as Local).setType(BooleanType.getInstance());
        const conditionExpr = new ArkConditionExpr(doneFlag, ValueUtil.getBooleanConstant(true), RelationalBinaryOperator.Equality);
        const conditionExprPositions = [doneFlagPositions[0], ...doneFlagPositions, FullPosition.DEFAULT];
        const ifStmt = new ArkIfStmt(conditionExpr);
        ifStmt.setOperandOriginalPositions(conditionExprPositions);
        stmts.push(ifStmt);

        const valueFieldSignature = new FieldSignature(Builtin.ITERATOR_RESULT_VALUE,
            Builtin.ITERATOR_RESULT_CLASS_SIGNATURE, UnknownType.getInstance(), false);
        const valueFieldRef = new ArkInstanceFieldRef(iteratorResult as Local, valueFieldSignature);
        const valueFieldRefPositions = [iteratorResultPositions[0], ...iteratorResultPositions];
        const {
            value: yieldValue,
            valueOriginalPositions: yieldValuePositions,
            stmts: yieldValueStmts,
        } = this.generateAssignStmtForValue(valueFieldRef, valueFieldRefPositions);
        stmts.push(...yieldValueStmts);

        // TODO: Support generics and then fill in the exact type
        const castExpr = new ArkCastExpr(yieldValue, UnknownType.getInstance());
        const castExprPositions = [yieldValuePositions[0], ...yieldValuePositions];
        if (ts.isVariableDeclarationList(forOfStatement.initializer)) {
            const variableDeclarationList = forOfStatement.initializer as ts.VariableDeclarationList;
            const isConst = (variableDeclarationList.flags & ts.NodeFlags.Const) !== 0;
            const variableDeclaration = variableDeclarationList.declarations[0];
            if (ts.isArrayBindingPattern(variableDeclaration.name)) {
                const {
                    value: arrayItem,
                    valueOriginalPositions: arrayItemPositions,
                    stmts: arrayItemStmts,
                } = this.generateAssignStmtForValue(castExpr, castExprPositions);
                stmts.push(...arrayItemStmts);
                (arrayItem as Local).setType(new ArrayType(UnknownType.getInstance(), 1));

                const elements = variableDeclaration.name.elements;
                let index = 0;
                for (const element of elements) {
                    const arrayRef = new ArkArrayRef(arrayItem as Local, ValueUtil.getOrCreateNumberConst(index));
                    const arrayRefPositions = [arrayItemPositions[0], ...arrayItemPositions, FullPosition.DEFAULT];
                    const item = new Local(element.getText(this.sourceFile));
                    const itemPosition = FullPosition.buildFromNode(element, this.sourceFile);
                    item.setConstFlag(isConst);
                    const assignStmt = new ArkAssignStmt(item, arrayRef);
                    assignStmt.setOperandOriginalPositions([itemPosition, ...arrayRefPositions]);
                    stmts.push(assignStmt);
                    index++;
                }
            } else if (ts.isObjectBindingPattern(variableDeclaration.name)) {
                const {
                    value: objectItem,
                    valueOriginalPositions: objectItemPositions,
                    stmts: objectItemStmts,
                } = this.generateAssignStmtForValue(castExpr, castExprPositions);
                stmts.push(...objectItemStmts);

                const elements = variableDeclaration.name.elements;
                for (const element of elements) {
                    const fieldName = element.propertyName ? element.propertyName.getText(this.sourceFile) : element.name.getText(this.sourceFile);
                    const fieldSignature = ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
                    const fieldRef = new ArkInstanceFieldRef(objectItem as Local, fieldSignature);
                    const fieldRefPositions = [objectItemPositions[0], ...objectItemPositions];
                    const fieldLocal = this.getOrCreatLocal(element.name.getText(this.sourceFile));
                    const fieldLocalPosition = FullPosition.buildFromNode(element, this.sourceFile);
                    fieldLocal.setConstFlag(isConst);
                    const assignStmt = new ArkAssignStmt(fieldLocal, fieldRef);
                    assignStmt.setOperandOriginalPositions([fieldLocalPosition, ...fieldRefPositions]);
                    stmts.push(assignStmt);
                }
            } else {
                const item = this.getOrCreatLocal(variableDeclaration.name.getText(this.sourceFile));
                item.setConstFlag(isConst);
                stmts.push(new ArkAssignStmt(item, castExpr));
            }
        } else {
            const { value: item, valueOriginalPositions: itemPositions, stmts: itemStmts } = this.tsNodeToValueAndStmts(
                forOfStatement.initializer);
            stmts.push(...itemStmts);
            const assignStmt = new ArkAssignStmt(item, castExpr);
            assignStmt.setOperandOriginalPositions([...itemPositions, ...castExprPositions]);
            stmts.push(assignStmt);
        }
        return stmts;
    }

    private whileStatementToStmts(whileStatement: ts.WhileStatement): Stmt[] {
        const stmts: Stmt[] = [];
        const dummyInitializerStmt = new DummyStmt(DUMMY_INITIALIZER_STMT);
        stmts.push(dummyInitializerStmt);

        const {
            value: conditionExpr,
            stmts: conditionStmts,
        } = this.conditionToValueAndStmts(whileStatement.expression);
        stmts.push(...conditionStmts);
        stmts.push(new ArkIfStmt(conditionExpr as ArkConditionExpr));
        return stmts;
    }

    private doStatementToStmts(doStatement: ts.DoStatement): Stmt[] {
        const stmts: Stmt[] = [];
        const {
            value: conditionExpr,
            stmts: conditionStmts,
        } = this.conditionToValueAndStmts(doStatement.expression);
        stmts.push(...conditionStmts);
        stmts.push(new ArkIfStmt(conditionExpr as ArkConditionExpr));
        return stmts;
    }

    private variableStatementToStmts(variableStatement: ts.VariableStatement): Stmt[] {
        return this.variableDeclarationListToStmts(variableStatement.declarationList);
    }

    private variableDeclarationListToStmts(variableDeclarationList: ts.VariableDeclarationList): Stmt[] {
        return this.variableDeclarationListToValueAndStmts(variableDeclarationList).stmts;
    }

    private ifStatementToStmts(ifStatement: ts.IfStatement): Stmt[] {
        const stmts: Stmt[] = [];
        if (this.inBuilderMethod) {
            const {
                value: conditionExpr,
                valueOriginalPositions: conditionExprPositions,
                stmts: conditionStmts,
            } = this.conditionToValueAndStmts(ifStatement.expression);
            stmts.push(...conditionStmts);
            const createMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_IF, COMPONENT_CREATE_FUNCTION);
            const {
                value: conditionLocal,
                valueOriginalPositions: conditionLocalPositions,
                stmts: assignConditionStmts
            } = this.generateAssignStmtForValue(conditionExpr, conditionExprPositions);
            stmts.push(...assignConditionStmts);
            const createInvokeExpr = new ArkStaticInvokeExpr(createMethodSignature, [conditionLocal]);
            const createInvokeExprPositions = [conditionLocalPositions[0], ...conditionLocalPositions];
            const { stmts: createStmts } = this.generateAssignStmtForValue(createInvokeExpr, createInvokeExprPositions);
            stmts.push(...createStmts);
            const branchMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_IF, COMPONENT_BRANCH_FUNCTION);
            const branchInvokeExpr = new ArkStaticInvokeExpr(branchMethodSignature, [ValueUtil.getOrCreateNumberConst(0)]);
            const branchInvokeExprPositions = [conditionLocalPositions[0], FullPosition.DEFAULT];
            const branchInvokeStmt = new ArkInvokeStmt(branchInvokeExpr);
            branchInvokeStmt.setOperandOriginalPositions(branchInvokeExprPositions);
            stmts.push(branchInvokeStmt);
            stmts.push(...this.tsNodeToStmts(ifStatement.thenStatement));
            if (ifStatement.elseStatement) {
                const branchElseMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_IF, COMPONENT_BRANCH_FUNCTION);
                const branchElseInvokeExpr = new ArkStaticInvokeExpr(branchElseMethodSignature, [ValueUtil.getOrCreateNumberConst(1)]);
                const branchElseInvokeExprPositions = [FullPosition.buildFromNode(ifStatement.elseStatement,
                    this.sourceFile), FullPosition.DEFAULT];
                const branchElseInvokeStmt = new ArkInvokeStmt(branchElseInvokeExpr);
                branchElseInvokeStmt.setOperandOriginalPositions(branchElseInvokeExprPositions);
                stmts.push(branchElseInvokeStmt);

                stmts.push(...this.tsNodeToStmts(ifStatement.elseStatement));
            }
            const popMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_IF, COMPONENT_POP_FUNCTION);
            const popInvokeExpr = new ArkStaticInvokeExpr(popMethodSignature, []);
            const popInvokeStmt = new ArkInvokeStmt(popInvokeExpr);
            stmts.push(popInvokeStmt);
        } else {
            const {
                value: conditionExpr,
                valueOriginalPositions: conditionExprPositions,
                stmts: conditionStmts,
            } = this.conditionToValueAndStmts(ifStatement.expression);
            stmts.push(...conditionStmts);
            const ifStmt = new ArkIfStmt(conditionExpr as ArkConditionExpr);
            ifStmt.setOperandOriginalPositions(conditionExprPositions);
            stmts.push(ifStmt);
        }
        return stmts;
    }

    private gotoStatementToStmts(gotoStatement: ts.BreakStatement | ts.ContinueStatement): Stmt[] {
        return [];
    }

    private throwStatementToStmts(throwStatement: ts.ThrowStatement): Stmt[] {
        const stmts: Stmt[] = [];
        const {
            value: throwValue,
            valueOriginalPositions: throwValuePositions,
            stmts: throwStmts,
        } = this.tsNodeToValueAndStmts(throwStatement.expression);
        stmts.push(...throwStmts);
        const throwStmt = new ArkThrowStmt(throwValue);
        throwStmt.setOperandOriginalPositions(throwValuePositions);
        stmts.push(throwStmt);
        return stmts;
    }

    private catchClauseToStmts(catchClause: ts.CatchClause): Stmt[] {
        const stmts: Stmt[] = [];
        if (catchClause.variableDeclaration) {
            const {
                value: catchValue,
                valueOriginalPositions: catchValuePositions,
                stmts: catchStmts,
            } = this.tsNodeToValueAndStmts(catchClause.variableDeclaration);
            stmts.push(...catchStmts);
            const caughtExceptionRef = new ArkCaughtExceptionRef(UnknownType.getInstance());
            const assignStmt = new ArkAssignStmt(catchValue, caughtExceptionRef);
            assignStmt.setOperandOriginalPositions(catchValuePositions);
            stmts.push(assignStmt);
        }
        return stmts;
    }

    public tsNodeToValueAndStmts(node: ts.Node): ValueAndStmts {
        if (ts.isBinaryExpression(node)) {
            return this.binaryExpressionToValueAndStmts(node);
        } else if (ts.isCallExpression(node)) {
            return this.callExpressionToValueAndStmts(node);
        } else if (ts.isVariableDeclarationList(node)) {
            return this.variableDeclarationListToValueAndStmts(node);
        } else if (ts.isIdentifier(node)) {
            return this.identifierToValueAndStmts(node);
        } else if (ts.isPropertyAccessExpression(node)) {
            return this.propertyAccessExpressionToValue(node);
        } else if (ts.isPrefixUnaryExpression(node)) {
            return this.prefixUnaryExpressionToValueAndStmts(node);
        } else if (ts.isPostfixUnaryExpression(node)) {
            return this.postfixUnaryExpressionToValueAndStmts(node);
        } else if (ts.isTemplateExpression(node)) {
            return this.templateExpressionToValueAndStmts(node);
        } else if (ts.isAwaitExpression(node)) {
            return this.awaitExpressionToValueAndStmts(node);
        } else if (ts.isYieldExpression(node)) {
            return this.yieldExpressionToValueAndStmts(node);
        } else if (ts.isDeleteExpression(node)) {
            return this.deleteExpressionToValueAndStmts(node);
        } else if (ts.isVoidExpression(node)) {
            return this.voidExpressionToValueAndStmts(node);
        } else if (ts.isElementAccessExpression(node)) {
            return this.elementAccessExpressionToValueAndStmts(node);
        } else if (ts.isNewExpression(node)) {
            return this.newExpressionToValueAndStmts(node);
        } else if (ts.isParenthesizedExpression(node)) {
            return this.parenthesizedExpressionToValueAndStmts(node);
        } else if (ts.isAsExpression(node)) {
            return this.asExpressionToValueAndStmts(node);
        } else if (ts.isNonNullExpression(node)) {
            return this.nonNullExpressionToValueAndStmts(node);
        } else if (ts.isTypeAssertionExpression(node)) {
            return this.typeAssertionToValueAndStmts(node);
        } else if (ts.isTypeOfExpression(node)) {
            return this.typeOfExpressionToValueAndStmts(node);
        } else if (ts.isArrayLiteralExpression(node)) {
            return this.arrayLiteralExpressionToValueAndStmts(node);
        } else if (this.isLiteralNode(node)) {
            return this.literalNodeToValueAndStmts(node) as ValueAndStmts;
        } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            return this.callableNodeToValueAndStmts(node);
        } else if (ts.isClassExpression(node)) {
            return this.classExpressionToValueAndStmts(node);
        } else if (ts.isEtsComponentExpression(node)) {
            return this.etsComponentExpressionToValueAndStmts(node);
        } else if (ts.isObjectLiteralExpression(node)) {
            return this.objectLiteralExpresionToValueAndStmts(node);
        } else if (node.kind === ts.SyntaxKind.ThisKeyword) {
            return this.thisExpressionToValueAndStmts(node as ts.ThisExpression);
        } else if (ts.isConditionalExpression(node)) {
            return this.conditionalExpressionToValueAndStmts(node);
        }

        return {
            value: new Local(node.getText(this.sourceFile)),
            valueOriginalPositions: [FullPosition.buildFromNode(node, this.sourceFile)],
            stmts: [],
        };
    }

    private thisExpressionToValueAndStmts(thisExpression: ts.ThisExpression): ValueAndStmts {
        return {
            value: this.getThisLocal(),
            valueOriginalPositions: [FullPosition.buildFromNode(thisExpression, this.sourceFile)],
            stmts: [],
        };
    }

    private conditionalExpressionToValueAndStmts(conditionalExpression: ts.ConditionalExpression): ValueAndStmts {
        // TODO: separated by blocks
        const stmts: Stmt[] = [];
        const {
            value: conditionValue,
            valueOriginalPositions: conditionPositions,
            stmts: conditionStmts,
        } = this.conditionToValueAndStmts(conditionalExpression.condition);
        stmts.push(...conditionStmts);
        const ifStmt = new ArkIfStmt(conditionValue as ArkConditionExpr);
        ifStmt.setOperandOriginalPositions(conditionPositions);
        stmts.push(ifStmt);

        const {
            value: whenTrueValue,
            valueOriginalPositions: whenTruePositions,
            stmts: whenTrueStmts
        } = this.tsNodeToValueAndStmts(conditionalExpression.whenTrue);
        stmts.push(...whenTrueStmts);
        const {
            value: resultValue,
            valueOriginalPositions: resultPositions,
            stmts: tempStmts,
        } = this.generateAssignStmtForValue(whenTrueValue, whenTruePositions);
        stmts.push(...tempStmts);
        const {
            value: whenFalseValue,
            valueOriginalPositions: whenFalsePositions,
            stmts: whenFalseStmts,
        } = this.tsNodeToValueAndStmts(conditionalExpression.whenFalse);
        stmts.push(...whenFalseStmts);
        const assignStmt = new ArkAssignStmt(resultValue, whenFalseValue);
        assignStmt.setOperandOriginalPositions([...resultPositions, ...whenFalsePositions]);
        stmts.push(assignStmt);
        return { value: resultValue, valueOriginalPositions: resultPositions, stmts: stmts };
    }

    private objectLiteralExpresionToValueAndStmts(objectLiteralExpression: ts.ObjectLiteralExpression): ValueAndStmts {
        const declaringArkClass = this.declaringMethod.getDeclaringArkClass();
        const declaringArkNamespace = declaringArkClass.getDeclaringArkNamespace();
        const anonymousClass = new ArkClass();
        if (declaringArkNamespace) {
            buildNormalArkClassFromArkNamespace(objectLiteralExpression, declaringArkNamespace, anonymousClass, this.sourceFile, this.declaringMethod);
            declaringArkNamespace.addArkClass(anonymousClass);
        } else {
            const declaringArkFile = declaringArkClass.getDeclaringArkFile();
            buildNormalArkClassFromArkFile(objectLiteralExpression, declaringArkFile, anonymousClass, this.sourceFile, this.declaringMethod);
            declaringArkFile.addArkClass(anonymousClass);
        }

        const objectLiteralExpressionPosition = FullPosition.buildFromNode(objectLiteralExpression, this.sourceFile);
        const stmts: Stmt[] = [];
        const anonymousClassSignature = anonymousClass.getSignature();
        const anonymousClassType = new ClassType(anonymousClassSignature);
        const newExpr = new ArkNewExpr(anonymousClassType);
        const {
            value: newExprLocal,
            valueOriginalPositions: newExprLocalPositions,
            stmts: newExprStmts,
        } = this.generateAssignStmtForValue(newExpr, [objectLiteralExpressionPosition]);
        stmts.push(...newExprStmts);

        const constructorMethodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(
            CONSTRUCTOR_NAME);
        const constructorMethodSignature = new MethodSignature(anonymousClassSignature, constructorMethodSubSignature);
        const constructorInvokeExpr = new ArkInstanceInvokeExpr(newExprLocal as Local, constructorMethodSignature, []);
        const constructorInvokeExprPositions = [objectLiteralExpressionPosition, ...newExprLocalPositions];
        const constructorInvokeStmt = new ArkInvokeStmt(constructorInvokeExpr);
        constructorInvokeStmt.setOperandOriginalPositions(constructorInvokeExprPositions);
        stmts.push(constructorInvokeStmt);
        return { value: newExprLocal, valueOriginalPositions: newExprLocalPositions, stmts: stmts };
    }

    private createCustomViewStmt(componentName: string, args: Value[], argPositionsAll: FullPosition[][],
                                 componentExpression: ts.EtsComponentExpression | ts.CallExpression, currStmts: Stmt[]): ValueAndStmts {
        const stmts: Stmt[] = [...currStmts];
        const componentExpressionPosition = FullPosition.buildFromNode(componentExpression, this.sourceFile);
        const classSignature = ArkSignatureBuilder.buildClassSignatureFromClassName(componentName);
        const classType = new ClassType(classSignature);
        const newExpr = new ArkNewExpr(classType);
        const {
            value: newExprLocal,
            valueOriginalPositions: newExprPositions,
            stmts: newExprStmts,
        } = this.generateAssignStmtForValue(newExpr,
            [componentExpressionPosition]);
        stmts.push(...newExprStmts);

        const constructorMethodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(
            CONSTRUCTOR_NAME);
        const constructorMethodSignature = new MethodSignature(classSignature, constructorMethodSubSignature);
        const instanceInvokeExpr = new ArkInstanceInvokeExpr(newExprLocal as Local, constructorMethodSignature, args);
        const instanceInvokeExprPositions = [componentExpressionPosition, ...newExprPositions,
            ...argPositionsAll.flat()];
        const instanceInvokeStmt = new ArkInvokeStmt(instanceInvokeExpr);
        instanceInvokeStmt.setOperandOriginalPositions(instanceInvokeExprPositions);
        stmts.push(instanceInvokeStmt);

        const createViewArgs = [newExprLocal];
        const createViewArgPositionsAll = [newExprPositions];
        if (ts.isEtsComponentExpression(componentExpression) && componentExpression.body) {
            const anonymous = ts.factory.createArrowFunction([], [], [], undefined, undefined, componentExpression.body);
            // @ts-expect-error: add pos info for the created ArrowFunction
            anonymous.pos = componentExpression.body.pos;
            // @ts-expect-error: add end info for the created ArrowFunction
            anonymous.end = componentExpression.body.end;

            const {
                value: builderMethod,
                valueOriginalPositions: builderMethodPositions,
            } = this.callableNodeToValueAndStmts(anonymous);
            createViewArgs.push(builderMethod);
            createViewArgPositionsAll.push(builderMethodPositions);
        }
        const createMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_CUSTOMVIEW, COMPONENT_CREATE_FUNCTION);
        const createInvokeExpr = new ArkStaticInvokeExpr(createMethodSignature, createViewArgs);
        const createInvokeExprPositions = [componentExpressionPosition, ...createViewArgPositionsAll.flat()];
        const {
            value: componentValue,
            valueOriginalPositions: componentPositions,
            stmts: componentStmts,
        } = this.generateAssignStmtForValue(createInvokeExpr, createInvokeExprPositions);
        stmts.push(...componentStmts);
        const popMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(COMPONENT_CUSTOMVIEW, COMPONENT_POP_FUNCTION);
        const popInvokeExpr = new ArkStaticInvokeExpr(popMethodSignature, []);
        const popInvokeExprPositions = [componentExpressionPosition];
        const popInvokeStmt = new ArkInvokeStmt(popInvokeExpr);
        popInvokeStmt.setOperandOriginalPositions(popInvokeExprPositions);
        stmts.push(popInvokeStmt);
        return { value: componentValue, valueOriginalPositions: componentPositions, stmts: stmts };
    }

    private etsComponentExpressionToValueAndStmts(etsComponentExpression: ts.EtsComponentExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        const componentName = (etsComponentExpression.expression as ts.Identifier).text;
        let builderMethodIndexes: Set<number> | undefined;
        if (componentName === COMPONENT_FOR_EACH || componentName === COMPONENT_LAZY_FOR_EACH) {
            builderMethodIndexes = new Set<number>([1]);
        }
        const { args: args, argPositionsAll: argPositionsAll } = this.parseArguments(stmts,
            etsComponentExpression.arguments, builderMethodIndexes);

        if (isEtsSystemComponent(componentName)) {
            const createMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(componentName, COMPONENT_CREATE_FUNCTION);
            const createInvokeExpr = new ArkStaticInvokeExpr(createMethodSignature, args);
            const argPositionsAllFlat = argPositionsAll.flat();
            let createInvokeExprPosition = FullPosition.buildFromNode(etsComponentExpression, this.sourceFile);
            const createInvokeExprPositions = [createInvokeExprPosition, ...argPositionsAllFlat];
            const {
                value: componentValue,
                valueOriginalPositions: componentPositions,
                stmts: componentStmts,
            } = this.generateAssignStmtForValue(createInvokeExpr, createInvokeExprPositions);
            stmts.push(...componentStmts);

            if (etsComponentExpression.body) {
                for (const statement of etsComponentExpression.body.statements) {
                    stmts.push(...this.tsNodeToStmts(statement));
                }
            }

            const popMethodSignature = ArkSignatureBuilder.buildMethodSignatureFromClassNameAndMethodName(componentName, COMPONENT_POP_FUNCTION);
            const popInvokeExpr = new ArkStaticInvokeExpr(popMethodSignature, []);
            const popInvokeExprPositions = [FullPosition.DEFAULT];
            const popInvokeStmt = new ArkInvokeStmt(popInvokeExpr);
            popInvokeStmt.setOperandOriginalPositions(popInvokeExprPositions);
            stmts.push(popInvokeStmt);
            return { value: componentValue, valueOriginalPositions: componentPositions, stmts: stmts };
        }

        return this.createCustomViewStmt(componentName, args, argPositionsAll, etsComponentExpression, stmts);
    }

    private classExpressionToValueAndStmts(classExpression: ts.ClassExpression): ValueAndStmts {
        const declaringArkClass = this.declaringMethod.getDeclaringArkClass();
        const declaringArkNamespace = declaringArkClass.getDeclaringArkNamespace();
        const newClass = new ArkClass();
        if (declaringArkNamespace) {
            buildNormalArkClassFromArkNamespace(classExpression, declaringArkNamespace, newClass, this.sourceFile, this.declaringMethod);
            declaringArkNamespace.addArkClass(newClass);
        } else {
            const declaringArkFile = declaringArkClass.getDeclaringArkFile();
            buildNormalArkClassFromArkFile(classExpression, declaringArkFile, newClass, this.sourceFile, this.declaringMethod);
            declaringArkFile.addArkClass(newClass);
        }
        const classValue = this.getOrCreatLocal(newClass.getName(), new ClassType(newClass.getSignature()));
        return {
            value: classValue,
            valueOriginalPositions: [FullPosition.buildFromNode(classExpression, this.sourceFile)],
            stmts: [],
        };
    }

    private templateExpressionToValueAndStmts(templateExpression: ts.TemplateExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        const head = templateExpression.head;
        const templateValues: Value[] = [];
        const templatePositions: FullPosition[][] = [];
        if (head.rawText) {
            templateValues.push(ValueUtil.createStringConst(head.rawText));
            templatePositions.push([FullPosition.buildFromNode(head, this.sourceFile)]);
        }
        for (const templateSpan of templateExpression.templateSpans) {
            let {
                value: exprValue,
                valueOriginalPositions: exprPositions,
                stmts: exprStmts,
            } = this.tsNodeToValueAndStmts(templateSpan.expression);
            stmts.push(...exprStmts);
            if (IRUtils.moreThanOneAddress(exprValue)) {
                ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } =
                    this.generateAssignStmtForValue(exprValue, exprPositions));
                stmts.push(...exprStmts);
            }
            templateValues.push(exprValue);
            templatePositions.push(exprPositions);
            const literalRawText = templateSpan.literal.rawText;
            if (literalRawText) {
                templateValues.push(ValueUtil.createStringConst(literalRawText));
                templatePositions.push([FullPosition.buildFromNode(templateSpan.literal, this.sourceFile)]);
            }
        }

        let currTemplateValue: Value = ValueUtil.getUndefinedConst();
        let currTemplatePositions: FullPosition[] = [FullPosition.DEFAULT];
        const templateValueCnt = templateValues.length;
        if (templateValueCnt > 0) {
            currTemplateValue = templateValues[0];
            currTemplatePositions = templatePositions[0];
            for (let i = 1; i < templateValueCnt; i++) {
                const nextTemplatePositions = templatePositions[i];
                const normalBinopExpr = new ArkNormalBinopExpr(currTemplateValue, templateValues[i],
                    NormalBinaryOperator.Addition);
                const normalBinopExprPositions = [FullPosition.merge(currTemplatePositions[0],
                    nextTemplatePositions[0]), ...currTemplatePositions, ...nextTemplatePositions];
                const {
                    value: combinationValue,
                    valueOriginalPositions: combinationPositions,
                    stmts: combinationStmts,
                } = this.generateAssignStmtForValue(normalBinopExpr, normalBinopExprPositions);
                stmts.push(...combinationStmts);
                currTemplateValue = combinationValue;
                currTemplatePositions = combinationPositions;
            }
        }
        return { value: currTemplateValue, valueOriginalPositions: currTemplatePositions, stmts: stmts };
    }

    private identifierToValueAndStmts(identifier: ts.Identifier): ValueAndStmts {
        // TODO: handle global variable
        let identifierValue: Value;
        let identifierPositions = [FullPosition.buildFromNode(identifier, this.sourceFile)];
        if (identifier.text === UndefinedType.getInstance().getName()) {
            identifierValue = ValueUtil.getUndefinedConst();
        } else {
            identifierValue = this.getOrCreatLocal(identifier.text);
        }
        return { value: identifierValue, valueOriginalPositions: identifierPositions, stmts: [] };
    }

    private propertyAccessExpressionToValue(propertyAccessExpression: ts.PropertyAccessExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let {
            value: baseValue,
            valueOriginalPositions: basePositions,
            stmts: baseStmts,
        } = this.tsNodeToValueAndStmts(propertyAccessExpression.expression);
        stmts.push(...baseStmts);
        if (IRUtils.moreThanOneAddress(baseValue)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.generateAssignStmtForValue(baseValue, basePositions));
            stmts.push(...baseStmts);
        }
        if (!(baseValue instanceof Local)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.generateAssignStmtForValue(baseValue, basePositions));
            stmts.push(...baseStmts);
        }
        const fieldSignature = ArkSignatureBuilder.buildFieldSignatureFromFieldName(
            propertyAccessExpression.name.getText(this.sourceFile));
        const fieldRef = new ArkInstanceFieldRef(baseValue as Local, fieldSignature);
        const fieldRefPositions = [FullPosition.buildFromNode(propertyAccessExpression,
            this.sourceFile), ...basePositions];
        return { value: fieldRef, valueOriginalPositions: fieldRefPositions, stmts: stmts };
    }

    private elementAccessExpressionToValueAndStmts(elementAccessExpression: ts.ElementAccessExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let { value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } = this.tsNodeToValueAndStmts(
            elementAccessExpression.expression);
        stmts.push(...baseStmts);
        if (!(baseValue instanceof Local)) {
            ({ value: baseValue, valueOriginalPositions: basePositions, stmts: baseStmts } =
                this.generateAssignStmtForValue(baseValue, basePositions));
            stmts.push(...baseStmts);
        }
        let {
            value: argumentValue,
            valueOriginalPositions: arguPositions,
            stmts: argumentStmts,
        } = this.tsNodeToValueAndStmts(elementAccessExpression.argumentExpression);
        stmts.push(...argumentStmts);
        if (IRUtils.moreThanOneAddress(argumentValue)) {
            ({ value: argumentValue, valueOriginalPositions: arguPositions, stmts: argumentStmts } =
                this.generateAssignStmtForValue(argumentValue, arguPositions));
            stmts.push(...argumentStmts);
        }

        let elementAccessExpr: Value;
        if (baseValue.getType() instanceof ArrayType) {
            elementAccessExpr = new ArkArrayRef(baseValue as Local, argumentValue);
        } else {
            // TODO: deal with ArkStaticFieldRef
            const fieldSignature = ArkSignatureBuilder.buildFieldSignatureFromFieldName(argumentValue.toString());
            elementAccessExpr = new ArkInstanceFieldRef(baseValue as Local, fieldSignature);
        }
        const exprPositions = [FullPosition.buildFromNode(elementAccessExpression, this.sourceFile), ...basePositions,
            ...arguPositions];
        return { value: elementAccessExpr, valueOriginalPositions: exprPositions, stmts: stmts };
    }

    private callExpressionToValueAndStmts(callExpression: ts.CallExpression): ValueAndStmts {
        let realGenericTypes: Type[] | undefined;
        if (callExpression.typeArguments) {
            realGenericTypes = [];
            callExpression.typeArguments.forEach(typeArgument => {
                realGenericTypes!.push(this.resolveTypeNode(typeArgument));
            });
        }
        const stmts: Stmt[] = [];
        const { args: args, argPositionsAll: argPositionsAll } = this.parseArguments(stmts, callExpression.arguments);
        const argPositionsAllFlat = argPositionsAll.flat();
        let {
            value: callerValue,
            valueOriginalPositions: callerPositions,
            stmts: callerStmts,
        } = this.tsNodeToValueAndStmts(callExpression.expression);
        stmts.push(...callerStmts);
        let invokeValue: Value;
        let invokeValuePositions: FullPosition[] = [FullPosition.buildFromNode(callExpression, this.sourceFile)];
        if (callerValue instanceof ArkInstanceFieldRef) {
            const methodSignature = ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerValue.getFieldName())
            invokeValue = new ArkInstanceInvokeExpr(callerValue.getBase(), methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...callerPositions.slice(1), ...argPositionsAllFlat);
        } else if (callerValue instanceof ArkStaticFieldRef) {
            const methodSignature = ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerValue.getFieldName())
            invokeValue = new ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...argPositionsAllFlat);
        } else if (callerValue instanceof Local) {
            const callerName = callerValue.getName();
            let classSignature = ArkSignatureBuilder.buildClassSignatureFromClassName(callerName);
            let cls = ModelUtils.getClass(this.declaringMethod, classSignature);
            if (cls?.hasComponentDecorator()) {
                return this.createCustomViewStmt(callerName, args, argPositionsAll, callExpression, stmts);
            }
            const methodSignature = ArkSignatureBuilder.buildMethodSignatureFromMethodName(callerName)
            if (callerValue.getType() instanceof FunctionType) {
                invokeValue = new ArkPtrInvokeExpr(methodSignature, callerValue, args, realGenericTypes);
            } else {
                invokeValue = new ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            }
            invokeValuePositions.push(...argPositionsAllFlat);
        } else {
            ({ value: callerValue, valueOriginalPositions: callerPositions, stmts: callerStmts } =
                this.generateAssignStmtForValue(callerValue, callerPositions));
            stmts.push(...callerStmts);
            const methodSignature = ArkSignatureBuilder.buildMethodSignatureFromMethodName((callerValue as Local).getName())
            invokeValue = new ArkStaticInvokeExpr(methodSignature, args, realGenericTypes);
            invokeValuePositions.push(...argPositionsAllFlat);
        }
        return { value: invokeValue, valueOriginalPositions: invokeValuePositions, stmts: stmts };
    }

    private parseArguments(currStmts: Stmt[], argumentNodes?: ts.NodeArray<ts.Expression>,
                           builderMethodIndexes?: Set<number>): {
        args: Value[],
        argPositionsAll: FullPosition[][]
    } {
        const args: Value[] = [];
        const argPositionsAll: FullPosition[][] = [];
        if (argumentNodes) {
            for (let i = 0; i < argumentNodes.length; i++) {
                const argument = argumentNodes[i];
                const prevBuilderMethodContextFlag = this.builderMethodContextFlag;
                if (builderMethodIndexes?.has(i)) {
                    this.builderMethodContextFlag = true;
                }
                let {
                    value: argValue,
                    valueOriginalPositions: argPositions,
                    stmts: argStmts,
                } = this.tsNodeToValueAndStmts(argument);
                this.builderMethodContextFlag = prevBuilderMethodContextFlag;
                currStmts.push(...argStmts);
                if (IRUtils.moreThanOneAddress(argValue)) {
                    ({ value: argValue, valueOriginalPositions: argPositions, stmts: argStmts } =
                        this.generateAssignStmtForValue(argValue, argPositions));
                    currStmts.push(...argStmts);
                }
                args.push(argValue);
                argPositionsAll.push(argPositions);
            }
        }
        return { args: args, argPositionsAll: argPositionsAll };
    }

    private callableNodeToValueAndStmts(callableNode: ts.ArrowFunction | ts.FunctionExpression): ValueAndStmts {
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const arrowArkMethod = new ArkMethod();
        if (this.builderMethodContextFlag) {
            ModelUtils.implicitArkUIBuilderMethods.add(arrowArkMethod);
        }
        buildArkMethodFromArkClass(callableNode, declaringClass, arrowArkMethod, this.sourceFile, this.declaringMethod);

        const callableType = new FunctionType(arrowArkMethod.getSignature());
        const callableValue = this.getOrCreatLocal(arrowArkMethod.getName(), callableType);
        return {
            value: callableValue,
            valueOriginalPositions: [FullPosition.buildFromNode(callableNode, this.sourceFile)],
            stmts: [],
        };
    }

    private newExpressionToValueAndStmts(newExpression: ts.NewExpression): ValueAndStmts {
        const className = newExpression.expression.getText(this.sourceFile);
        if (className === Builtin.ARRAY) {
            return this.newArrayExpressionToValueAndStmts(newExpression);
        }
        const stmts: Stmt[] = [];
        let realGenericTypes: Type[] | undefined;
        if (newExpression.typeArguments) {
            realGenericTypes = [];
            newExpression.typeArguments.forEach(typeArgument => {
                realGenericTypes!.push(this.resolveTypeNode(typeArgument));
            });
        }

        const classSignature = ArkSignatureBuilder.buildClassSignatureFromClassName(className);
        const classType = new ClassType(classSignature, realGenericTypes);
        const newExpr = new ArkNewExpr(classType);
        const {
            value: newLocal,
            valueOriginalPositions: newLocalPositions,
            stmts: newExprStmts,
        } = this.generateAssignStmtForValue(newExpr, [FullPosition.buildFromNode(newExpression, this.sourceFile)]);
        stmts.push(...newExprStmts);

        const constructorMethodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(
            CONSTRUCTOR_NAME);
        const constructorMethodSignature = new MethodSignature(classSignature, constructorMethodSubSignature);

        const { args: argValues, argPositionsAll: argPositionsAll } = this.parseArguments(stmts,
            newExpression.arguments);
        const instanceInvokeExpr = new ArkInstanceInvokeExpr(newLocal as Local, constructorMethodSignature,
            argValues);
        const instanceInvokeExprPositions = [newLocalPositions[0], ...newLocalPositions, ...argPositionsAll.flat()];
        const invokeStmt = new ArkInvokeStmt(instanceInvokeExpr);
        invokeStmt.setOperandOriginalPositions(instanceInvokeExprPositions);
        stmts.push(invokeStmt);
        return { value: newLocal, valueOriginalPositions: newLocalPositions, stmts: stmts };
    }

    private newArrayExpressionToValueAndStmts(newArrayExpression: ts.NewExpression): ValueAndStmts {
        let baseType: Type = UnknownType.getInstance();
        if (newArrayExpression.typeArguments && newArrayExpression.typeArguments.length > 0) {
            const argumentType = this.resolveTypeNode(newArrayExpression.typeArguments[0]);
            if (!(argumentType instanceof AnyType || argumentType instanceof UnknownType)) {
                baseType = argumentType;
            }
        }
        const stmts: Stmt[] = [];
        const { args: argumentValues, argPositionsAll: argumentPositionsAll } = this.parseArguments(stmts,
            newArrayExpression.arguments);
        let arrayLength = newArrayExpression.arguments ? newArrayExpression.arguments.length : 0;
        let arrayLengthValue: Value = ValueUtil.getOrCreateNumberConst(arrayLength);
        let arrayLengthPosition = FullPosition.DEFAULT;
        let arrayLengthFlag = false;
        if ((arrayLength === 1) && ((argumentValues[0].getType() instanceof NumberType) || argumentValues[0].getType() instanceof UnknownType)) {
            arrayLengthValue = argumentValues[0];
            arrayLengthPosition = argumentPositionsAll[0][0];
            arrayLengthFlag = true;
        }
        if (baseType instanceof UnknownType) {
            if ((arrayLength > 1) && !(argumentValues[0].getType() instanceof UnknownType)) {
                baseType = argumentValues[0].getType();
            } else {
                baseType = AnyType.getInstance();
            }
        }

        const newArrayExpr = new ArkNewArrayExpr(baseType, arrayLengthValue);
        const newArrayExprPositions = [FullPosition.buildFromNode(newArrayExpression, this.sourceFile),
            arrayLengthPosition];
        const {
            value: arrayLocal,
            valueOriginalPositions: arrayLocalPositions,
            stmts: arrayStmts,
        } = this.generateAssignStmtForValue(newArrayExpr, newArrayExprPositions);
        stmts.push(...arrayStmts);
        if (!arrayLengthFlag) {
            for (let i = 0; i < arrayLength; i++) {
                const arrayRef = new ArkArrayRef(arrayLocal as Local, ValueUtil.getOrCreateNumberConst(i));
                const arrayRefPositions = [arrayLocalPositions[0], ...arrayLocalPositions, FullPosition.DEFAULT];
                const assignStmt = new ArkAssignStmt(arrayRef, argumentValues[i]);
                assignStmt.setOperandOriginalPositions([...arrayRefPositions, ...argumentPositionsAll[i]]);
                stmts.push(assignStmt);
            }
        }
        return { value: arrayLocal, valueOriginalPositions: arrayLocalPositions, stmts: stmts };
    }

    private arrayLiteralExpressionToValueAndStmts(arrayLiteralExpression: ts.ArrayLiteralExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        const elementTypes: Set<Type> = new Set();
        const elementValues: Value[] = [];
        const elementPositonsAll: FullPosition[][] = [];
        const arrayLength = arrayLiteralExpression.elements.length;
        for (const element of arrayLiteralExpression.elements) {
            let {
                value: elementValue,
                valueOriginalPositions: elementPosition,
                stmts: elementStmts,
            } = this.tsNodeToValueAndStmts(element);
            stmts.push(...elementStmts);
            if (IRUtils.moreThanOneAddress(elementValue)) {
                ({ value: elementValue, valueOriginalPositions: elementPosition, stmts: elementStmts } =
                    this.generateAssignStmtForValue(elementValue, elementPosition));
                stmts.push(...elementStmts);
            }
            elementValues.push(elementValue);
            elementTypes.add(elementValue.getType());
            elementPositonsAll.push(elementPosition);
        }

        let baseType: Type = AnyType.getInstance();
        if (elementTypes.size === 1) {
            baseType = elementTypes.keys().next().value as Type;
        } else if (elementTypes.size > 1) {
            baseType = new UnionType(Array.from(elementTypes));
        }
        const newArrayExpr = new ArkNewArrayExpr(baseType, ValueUtil.getOrCreateNumberConst(arrayLength), true);
        const newArrayExprPositions = [FullPosition.buildFromNode(arrayLiteralExpression, this.sourceFile),
            FullPosition.DEFAULT];
        const {
            value: newArrayLocal,
            valueOriginalPositions: newArrayPositions,
            stmts: elementStmts,
        } = this.generateAssignStmtForValue(newArrayExpr, newArrayExprPositions);
        stmts.push(...elementStmts);

        for (let i = 0; i < arrayLength; i++) {
            const arrayRef = new ArkArrayRef(newArrayLocal as Local, ValueUtil.getOrCreateNumberConst(i));
            const arrayRefPositions = [newArrayPositions[0], ...newArrayPositions, FullPosition.DEFAULT];
            const assignStmt = new ArkAssignStmt(arrayRef, elementValues[i]);
            assignStmt.setOperandOriginalPositions([...arrayRefPositions, ...elementPositonsAll[i]]);
            stmts.push(assignStmt);
        }
        return { value: newArrayLocal, valueOriginalPositions: newArrayPositions, stmts: stmts };
    }

    private prefixUnaryExpressionToValueAndStmts(prefixUnaryExpression: ts.PrefixUnaryExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let {
            value: operandValue,
            valueOriginalPositions: operandPositions,
            stmts: operandStmts,
        } = this.tsNodeToValueAndStmts(prefixUnaryExpression.operand);
        stmts.push(...operandStmts);
        if (IRUtils.moreThanOneAddress(operandValue)) {
            ({ value: operandValue, valueOriginalPositions: operandPositions, stmts: operandStmts } =
                this.generateAssignStmtForValue(operandValue, operandPositions));
            stmts.push(...operandStmts);
        }

        const operatorToken = prefixUnaryExpression.operator;
        let exprPositions = [FullPosition.buildFromNode(prefixUnaryExpression, this.sourceFile)];
        if (operatorToken === ts.SyntaxKind.PlusPlusToken || operatorToken === ts.SyntaxKind.MinusMinusToken) {
            const binaryOperator = operatorToken === ts.SyntaxKind.PlusPlusToken ? NormalBinaryOperator.Addition : NormalBinaryOperator.Subtraction;
            const binopExpr = new ArkNormalBinopExpr(operandValue, ValueUtil.getOrCreateNumberConst(1), binaryOperator);
            exprPositions.push(...operandPositions, FullPosition.DEFAULT);
            const assignStmt = new ArkAssignStmt(operandValue, binopExpr);
            assignStmt.setOperandOriginalPositions([...operandPositions, ...exprPositions]);
            stmts.push(assignStmt);
            return { value: operandValue, valueOriginalPositions: operandPositions, stmts: stmts };
        } else if (operatorToken === ts.SyntaxKind.PlusToken) {
            return { value: operandValue, valueOriginalPositions: operandPositions, stmts: stmts };
        } else {
            let unopExpr: Value;
            const operator = ArkIRTransformer.tokenToUnaryOperator(operatorToken);
            if (operator) {
                unopExpr = new ArkUnopExpr(operandValue, operator);
                exprPositions.push(...operandPositions);
            } else {
                unopExpr = ValueUtil.getUndefinedConst();
                exprPositions = [FullPosition.DEFAULT];
            }
            return { value: unopExpr, valueOriginalPositions: exprPositions, stmts: stmts };
        }
    }

    private postfixUnaryExpressionToValueAndStmts(postfixUnaryExpression: ts.PostfixUnaryExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let {
            value: operandValue,
            valueOriginalPositions: operandPositions,
            stmts: exprStmts,
        } = this.tsNodeToValueAndStmts(postfixUnaryExpression.operand);
        stmts.push(...exprStmts);
        if (IRUtils.moreThanOneAddress(operandValue)) {
            ({ value: operandValue, valueOriginalPositions: operandPositions, stmts: exprStmts } =
                this.generateAssignStmtForValue(operandValue, operandPositions));
            stmts.push(...exprStmts);
        }

        let value: Value;
        let exprPositions = [FullPosition.buildFromNode(postfixUnaryExpression, this.sourceFile)];
        const operatorToken = postfixUnaryExpression.operator;
        if (operatorToken === ts.SyntaxKind.PlusPlusToken || operatorToken === ts.SyntaxKind.MinusMinusToken) {
            const binaryOperator = operatorToken === ts.SyntaxKind.PlusPlusToken ? NormalBinaryOperator.Addition : NormalBinaryOperator.Subtraction;
            const binopExpr = new ArkNormalBinopExpr(operandValue, ValueUtil.getOrCreateNumberConst(1), binaryOperator);
            exprPositions.push(...operandPositions, FullPosition.DEFAULT);
            const assignStmt = new ArkAssignStmt(operandValue, binopExpr);
            assignStmt.setOperandOriginalPositions([...operandPositions, ...exprPositions]);
            stmts.push(assignStmt);
            value = operandValue;
        } else {
            value = ValueUtil.getUndefinedConst();
            exprPositions = [FullPosition.DEFAULT];
        }

        return { value: value, valueOriginalPositions: exprPositions, stmts: stmts };
    }

    private awaitExpressionToValueAndStmts(awaitExpression: ts.AwaitExpression): ValueAndStmts {
        const {
            value: promiseValue,
            valueOriginalPositions: promisePositions,
            stmts: stmts,
        } = this.tsNodeToValueAndStmts(awaitExpression.expression);
        const awaitExpr = new ArkAwaitExpr(promiseValue);
        const awaitExprPositions = [FullPosition.buildFromNode(awaitExpression, this.sourceFile), ...promisePositions];
        return { value: awaitExpr, valueOriginalPositions: awaitExprPositions, stmts: stmts };
    }

    private yieldExpressionToValueAndStmts(yieldExpression: ts.YieldExpression): ValueAndStmts {
        let yieldValue: Value = ValueUtil.getUndefinedConst();
        let yieldPositions = [FullPosition.DEFAULT];
        let stmts: Stmt[] = [];
        if (yieldExpression.expression) {
            ({ value: yieldValue, valueOriginalPositions: yieldPositions, stmts: stmts } =
                this.tsNodeToValueAndStmts(yieldExpression.expression));
        }

        const yieldExpr = new ArkYieldExpr(yieldValue);
        const yieldExprPositions = [FullPosition.buildFromNode(yieldExpression, this.sourceFile), ...yieldPositions];
        return { value: yieldExpr, valueOriginalPositions: yieldExprPositions, stmts: stmts };
    }

    private deleteExpressionToValueAndStmts(deleteExpression: ts.DeleteExpression): ValueAndStmts {
        const { value: exprValue, valueOriginalPositions: exprPositions, stmts: stmts } = this.tsNodeToValueAndStmts(
            deleteExpression.expression);
        const deleteExpr = new ArkDeleteExpr(exprValue as AbstractFieldRef);
        const deleteExprPositions = [FullPosition.buildFromNode(deleteExpression, this.sourceFile),
            ...exprPositions];
        return { value: deleteExpr, valueOriginalPositions: deleteExprPositions, stmts: stmts };
    }

    private voidExpressionToValueAndStmts(voidExpression: ts.VoidExpression): ValueAndStmts {
        const stmts = this.expressionToStmts(voidExpression.expression);
        return { value: ValueUtil.getUndefinedConst(), valueOriginalPositions: [FullPosition.DEFAULT], stmts: stmts };
    }

    private nonNullExpressionToValueAndStmts(nonNullExpression: ts.NonNullExpression): ValueAndStmts {
        return this.tsNodeToValueAndStmts(nonNullExpression.expression);
    }

    private parenthesizedExpressionToValueAndStmts(parenthesizedExpression: ts.ParenthesizedExpression): ValueAndStmts {
        return this.tsNodeToValueAndStmts(parenthesizedExpression.expression);
    }

    private typeOfExpressionToValueAndStmts(typeOfExpression: ts.TypeOfExpression): ValueAndStmts {
        const {
            value: exprValue,
            valueOriginalPositions: exprPositions,
            stmts: exprStmts,
        } = this.tsNodeToValueAndStmts(typeOfExpression.expression);
        const typeOfExpr = new ArkTypeOfExpr(exprValue);
        const typeOfExprPositions = [FullPosition.buildFromNode(typeOfExpression, this.sourceFile), ...exprPositions];
        return { value: typeOfExpr, valueOriginalPositions: typeOfExprPositions, stmts: exprStmts };
    }

    private asExpressionToValueAndStmts(asExpression: ts.AsExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let { value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } = this.tsNodeToValueAndStmts(
            asExpression.expression);
        stmts.push(...exprStmts);
        if (IRUtils.moreThanOneAddress(exprValue)) {
            ({ value: exprValue, valueOriginalPositions: exprPositions, stmts: exprStmts } =
                this.generateAssignStmtForValue(exprValue, exprPositions));
            stmts.push(...exprStmts);
        }
        const castExpr = new ArkCastExpr(exprValue, this.resolveTypeNode(asExpression.type));
        const castExprPositions = [FullPosition.buildFromNode(asExpression, this.sourceFile), ...exprPositions];
        return { value: castExpr, valueOriginalPositions: castExprPositions, stmts: stmts };
    }

    private typeAssertionToValueAndStmts(typeAssertion: ts.TypeAssertion): ValueAndStmts {
        const {
            value: exprValue,
            valueOriginalPositions: exprPositions,
            stmts: exprStmts,
        } = this.tsNodeToValueAndStmts(typeAssertion.expression);
        const castExpr = new ArkCastExpr(exprValue, this.resolveTypeNode(typeAssertion.type));
        const castExprPositions = [FullPosition.buildFromNode(typeAssertion, this.sourceFile), ...exprPositions];
        return { value: castExpr, valueOriginalPositions: castExprPositions, stmts: exprStmts };
    }

    private variableDeclarationListToValueAndStmts(variableDeclarationList: ts.VariableDeclarationList): ValueAndStmts {
        const stmts: Stmt[] = [];
        for (const declaration of variableDeclarationList.declarations) {
            const {
                stmts: declaredStmts,
            } = this.variableDeclarationToValueAndStmts(declaration, variableDeclarationList.flags);
            stmts.push(...declaredStmts);
        }
        return { value: ValueUtil.getUndefinedConst(), valueOriginalPositions: [FullPosition.DEFAULT], stmts: stmts };
    }

    private variableDeclarationToValueAndStmts(variableDeclaration: ts.VariableDeclaration, nodeFlag: ts.NodeFlags): ValueAndStmts {
        const leftOpNode = variableDeclaration.name;
        let rightOpNode: ts.Node | null = null;
        if (variableDeclaration.initializer) {
            rightOpNode = variableDeclaration.initializer;
        }

        const stmts: Stmt[] = [];
        let { value: leftValue, valueOriginalPositions: leftPositions, stmts: leftStmts } = this.tsNodeToValueAndStmts(
            leftOpNode);
        stmts.push(...leftStmts);
        let rightValue: Value;
        let rightPositions: FullPosition[];
        if (rightOpNode) {
            let {
                value: tempRightValue,
                valueOriginalPositions: tempRightPositions,
                stmts: rightStmts,
            } = this.tsNodeToValueAndStmts(rightOpNode);
            stmts.push(...rightStmts);
            rightValue = tempRightValue;
            rightPositions = tempRightPositions;
        } else {
            rightValue = ValueUtil.getUndefinedConst();
            rightPositions = [FullPosition.DEFAULT];
        }
        if (IRUtils.moreThanOneAddress(leftValue) && IRUtils.moreThanOneAddress(rightValue)) {
            const {
                value: tempRightValue,
                valueOriginalPositions: tempRightPositions,
                stmts: rightStmts,
            } = this.generateAssignStmtForValue(rightValue, rightPositions);
            stmts.push(...rightStmts);
            rightValue = tempRightValue;
            rightPositions = tempRightPositions;
        }

        const isConst = (nodeFlag & ts.NodeFlags.Const) !== 0;
        if (leftValue instanceof Local) {
            leftValue.setConstFlag(isConst);
            if (variableDeclaration.type) {
                leftValue.setType(this.resolveTypeNode(variableDeclaration.type));
            }
            if (leftValue.getType() instanceof UnknownType && !(rightValue.getType() instanceof UnknownType) &&
                !(rightValue.getType() instanceof UndefinedType)) {
                leftValue.setType(rightValue.getType());
            }
        }
        const assignStmt = new ArkAssignStmt(leftValue, rightValue);
        assignStmt.setOperandOriginalPositions([...leftPositions, ...rightPositions]);
        stmts.push(assignStmt);

        if (ts.isArrayBindingPattern(leftOpNode)) {
            const elements = leftOpNode.elements;
            let index = 0;
            for (const element of elements) {
                const arrayRef = new ArkArrayRef(leftValue as Local, ValueUtil.getOrCreateNumberConst(index));
                const arrayRefPositions = [leftPositions[0], ...leftPositions, FullPosition.DEFAULT];
                const item = new Local(element.getText(this.sourceFile));
                const itemPosition = FullPosition.buildFromNode(element, this.sourceFile);
                item.setConstFlag(isConst);
                const assignStmt = new ArkAssignStmt(item, arrayRef);
                assignStmt.setOperandOriginalPositions([itemPosition, ...arrayRefPositions]);
                stmts.push(assignStmt);
                index++;
            }
        } else if (ts.isObjectBindingPattern(leftOpNode)) {
            const elements = leftOpNode.elements;
            for (const element of elements) {
                const fieldName = element.propertyName ? element.propertyName.getText(
                    this.sourceFile) : element.name.getText(this.sourceFile);
                const fieldSignature = ArkSignatureBuilder.buildFieldSignatureFromFieldName(fieldName);
                const fieldRef = new ArkInstanceFieldRef(leftValue as Local, fieldSignature);
                const fieldRefPositions = [leftPositions[0], ...leftPositions];
                const fieldLocal = this.getOrCreatLocal(element.name.getText(this.sourceFile));
                fieldLocal.setConstFlag(isConst);
                const fieldLocalPosition = FullPosition.buildFromNode(element, this.sourceFile);
                const assignStmt = new ArkAssignStmt(fieldLocal, fieldRef);
                assignStmt.setOperandOriginalPositions([fieldLocalPosition, ...fieldRefPositions]);
                stmts.push(assignStmt);
            }
        }
        return { value: leftValue, valueOriginalPositions: leftPositions, stmts: stmts };
    }

    private binaryExpressionToValueAndStmts(binaryExpression: ts.BinaryExpression): ValueAndStmts {
        const compoundAssignmentOperators = new Set([ts.SyntaxKind.PlusEqualsToken,
            ts.SyntaxKind.MinusEqualsToken,
            ts.SyntaxKind.AsteriskAsteriskEqualsToken,
            ts.SyntaxKind.AsteriskEqualsToken,
            ts.SyntaxKind.SlashEqualsToken,
            ts.SyntaxKind.PercentEqualsToken,
            ts.SyntaxKind.AmpersandEqualsToken,
            ts.SyntaxKind.BarEqualsToken,
            ts.SyntaxKind.CaretEqualsToken,
            ts.SyntaxKind.LessThanLessThanEqualsToken,
            ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
            ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
            ts.SyntaxKind.BarBarEqualsToken,
            ts.SyntaxKind.AmpersandAmpersandEqualsToken,
            ts.SyntaxKind.QuestionQuestionEqualsToken]);

        const operatorToken = binaryExpression.operatorToken;
        if (operatorToken.kind === ts.SyntaxKind.FirstAssignment) {
            return this.assignmentToValueAndStmts(binaryExpression);
        } else if (compoundAssignmentOperators.has(operatorToken.kind)) {
            return this.compoundAssignmentToValueAndStmts(binaryExpression);
        }

        const stmts: Stmt[] = [];
        let {
            value: opValue1,
            valueOriginalPositions: opPositions1,
            stmts: opStmts1,
        } = this.tsNodeToValueAndStmts(binaryExpression.left);
        stmts.push(...opStmts1);
        if (IRUtils.moreThanOneAddress(opValue1)) {
            ({ value: opValue1, valueOriginalPositions: opPositions1, stmts: opStmts1 } =
                this.generateAssignStmtForValue(opValue1, opPositions1));
            stmts.push(...opStmts1);
        }
        const binaryExpressionPosition = FullPosition.buildFromNode(binaryExpression, this.sourceFile);

        if (operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
            const instanceOfExpr = new ArkInstanceOfExpr(opValue1, new UnclearReferenceType(binaryExpression.right.getText(this.sourceFile)));
            const instanceOfExprPositions = [binaryExpressionPosition, ...opPositions1];
            return { value: instanceOfExpr, valueOriginalPositions: instanceOfExprPositions, stmts: stmts };
        }

        let {
            value: opValue2,
            valueOriginalPositions: opPositions2,
            stmts: opStmts2,
        } = this.tsNodeToValueAndStmts(binaryExpression.right);
        stmts.push(...opStmts2);
        if (IRUtils.moreThanOneAddress(opValue2)) {
            ({ value: opValue2, valueOriginalPositions: opPositions2, stmts: opStmts2 } =
                this.generateAssignStmtForValue(opValue2, opPositions2));
            stmts.push(...opStmts2);
        }

        let exprValue: Value;
        let exprValuePositions = [binaryExpressionPosition];
        if (operatorToken.kind === ts.SyntaxKind.CommaToken) {
            exprValue = opValue2;
        } else {
            const operator = ArkIRTransformer.tokenToBinaryOperator(operatorToken.kind);
            if (operator) {
                if (this.isRelationalOperator(operator)) {
                    exprValue = new ArkConditionExpr(opValue1, opValue2, operator as RelationalBinaryOperator);
                } else {
                    exprValue = new ArkNormalBinopExpr(opValue1, opValue2, operator as NormalBinaryOperator);
                }
                exprValuePositions.push(...opPositions1, ...opPositions2);
            } else {
                exprValue = ValueUtil.getUndefinedConst();
                exprValuePositions.push(binaryExpressionPosition);
            }
        }

        return { value: exprValue, valueOriginalPositions: exprValuePositions, stmts: stmts };
    }

    private assignmentToValueAndStmts(binaryExpression: ts.BinaryExpression): ValueAndStmts {
        const leftOpNode = binaryExpression.left;
        const rightOpNode = binaryExpression.right;
        const stmts: Stmt[] = [];
        let { value: leftValue, valueOriginalPositions: leftPositions, stmts: leftStmts } = this.tsNodeToValueAndStmts(
            leftOpNode);
        stmts.push(...leftStmts);
        let {
            value: rightValue,
            valueOriginalPositions: rightPositions,
            stmts: rightStmts,
        } = this.tsNodeToValueAndStmts(rightOpNode);
        stmts.push(...rightStmts);
        if (IRUtils.moreThanOneAddress(leftValue) && IRUtils.moreThanOneAddress(rightValue)) {
            const {
                value: newRightValue,
                valueOriginalPositions: newRightPositions,
                stmts: rightStmts,
            } = this.generateAssignStmtForValue(rightValue, rightPositions);
            stmts.push(...rightStmts);
            rightValue = newRightValue;
            rightPositions = newRightPositions;
        }
        if (leftValue instanceof Local && leftValue.getType() instanceof UnknownType
            && !(rightValue.getType() instanceof UnknownType)) {
            leftValue.setType(rightValue.getType());
        }

        const assignStmt = new ArkAssignStmt(leftValue, rightValue);
        assignStmt.setOperandOriginalPositions([...leftPositions, ...rightPositions]);
        stmts.push(assignStmt);
        return { value: leftValue, valueOriginalPositions: leftPositions, stmts: stmts };
    }

    private compoundAssignmentToValueAndStmts(binaryExpression: ts.BinaryExpression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let {
            value: leftValue,
            valueOriginalPositions: leftPositions,
            stmts: leftStmts,
        } = this.tsNodeToValueAndStmts(binaryExpression.left);
        stmts.push(...leftStmts);
        let {
            value: rightValue,
            valueOriginalPositions: rightPositions,
            stmts: rightStmts,
        } = this.tsNodeToValueAndStmts(binaryExpression.right);
        stmts.push(...rightStmts);
        if (IRUtils.moreThanOneAddress(leftValue) && IRUtils.moreThanOneAddress(rightValue)) {
            const {
                value: newRightValue,
                valueOriginalPositions: newRightPositions,
                stmts: rightStmts,
            } = this.generateAssignStmtForValue(rightValue, rightPositions);
            rightValue = newRightValue;
            rightPositions = newRightPositions;
            stmts.push(...rightStmts);
        }

        let leftOpValue: Value;
        let leftOpPositions: FullPosition[];
        const operator = this.compoundAssignmentTokenToBinaryOperator(binaryExpression.operatorToken.kind);
        if (operator) {
            const exprValue = new ArkNormalBinopExpr(leftValue, rightValue, operator);
            const exprValuePosition = FullPosition.buildFromNode(binaryExpression, this.sourceFile);
            const assignStmt = new ArkAssignStmt(leftValue, exprValue);
            assignStmt.setOperandOriginalPositions(
                [...leftPositions, exprValuePosition, ...leftPositions, ...rightPositions]);
            stmts.push(assignStmt);
            leftOpValue = leftValue;
            leftOpPositions = leftPositions;
        } else {
            leftOpValue = ValueUtil.getUndefinedConst();
            leftOpPositions = [leftPositions[0]];
        }
        return { value: leftOpValue, valueOriginalPositions: leftOpPositions, stmts: stmts };
    }

    private compoundAssignmentTokenToBinaryOperator(token: ts.SyntaxKind): NormalBinaryOperator | null {
        switch (token) {
            case ts.SyntaxKind.QuestionQuestionEqualsToken:
                return NormalBinaryOperator.NullishCoalescing;
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
                return NormalBinaryOperator.Exponentiation;
            case ts.SyntaxKind.SlashEqualsToken:
                return NormalBinaryOperator.Division;
            case ts.SyntaxKind.PlusEqualsToken:
                return NormalBinaryOperator.Addition;
            case ts.SyntaxKind.MinusEqualsToken:
                return NormalBinaryOperator.Subtraction;
            case ts.SyntaxKind.AsteriskEqualsToken:
                return NormalBinaryOperator.Multiplication;
            case ts.SyntaxKind.PercentEqualsToken:
                return NormalBinaryOperator.Remainder;
            case ts.SyntaxKind.LessThanLessThanEqualsToken:
                return NormalBinaryOperator.LeftShift;
            case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
                return NormalBinaryOperator.RightShift;
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
                return NormalBinaryOperator.UnsignedRightShift;
            case ts.SyntaxKind.AmpersandEqualsToken:
                return NormalBinaryOperator.BitwiseAnd;
            case ts.SyntaxKind.BarEqualsToken:
                return NormalBinaryOperator.BitwiseOr;
            case ts.SyntaxKind.CaretEqualsToken:
                return NormalBinaryOperator.BitwiseXor;
            case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
                return NormalBinaryOperator.LogicalAnd;
            case ts.SyntaxKind.BarBarEqualsToken:
                return NormalBinaryOperator.LogicalOr;
            default:
                ;
        }
        return null;
    }

    private conditionToValueAndStmts(condition: ts.Expression): ValueAndStmts {
        const stmts: Stmt[] = [];
        let {
            value: conditionValue,
            valueOriginalPositions: conditionPositions,
            stmts: conditionStmts,
        } = this.tsNodeToValueAndStmts(condition);
        stmts.push(...conditionStmts);
        let conditionExpr: ArkConditionExpr;
        if ((conditionValue instanceof AbstractBinopExpr) && this.isRelationalOperator(conditionValue.getOperator())) {
            const operator = conditionValue.getOperator() as RelationalBinaryOperator;
            conditionExpr = new ArkConditionExpr(conditionValue.getOp1(), conditionValue.getOp2(), operator);
        } else {
            if (IRUtils.moreThanOneAddress(conditionValue)) {
                ({
                    value: conditionValue,
                    valueOriginalPositions: conditionPositions,
                    stmts: conditionStmts,
                } = this.generateAssignStmtForValue(conditionValue, conditionPositions));
                stmts.push(...conditionStmts);
            }
            conditionExpr = new ArkConditionExpr(conditionValue, ValueUtil.getOrCreateNumberConst(0), RelationalBinaryOperator.InEquality);
            conditionPositions = [conditionPositions[0], ...conditionPositions, FullPosition.DEFAULT];
        }
        return { value: conditionExpr, valueOriginalPositions: conditionPositions, stmts: stmts };
    }

    private literalNodeToValueAndStmts(literalNode: ts.Node): ValueAndStmts | null {
        const syntaxKind = literalNode.kind;
        let constant: Constant | null = null;
        switch (syntaxKind) {
            case ts.SyntaxKind.NumericLiteral:
                constant = ValueUtil.getOrCreateNumberConst(parseFloat((literalNode as ts.NumericLiteral).text));
                break;
            case ts.SyntaxKind.BigIntLiteral:
                constant = ValueUtil.getOrCreateNumberConst(parseInt((literalNode as ts.BigIntLiteral).text));
                break;
            case ts.SyntaxKind.StringLiteral:
                constant = ValueUtil.createStringConst((literalNode as ts.StringLiteral).text);
                break;
            case ts.SyntaxKind.RegularExpressionLiteral:
                constant = new Constant((literalNode as ts.RegularExpressionLiteral).text, Builtin.REGEXP_CLASS_TYPE);
                break;
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
                constant = ValueUtil.createStringConst((literalNode as ts.NoSubstitutionTemplateLiteral).text);
                break;
            case ts.SyntaxKind.NullKeyword:
                constant = ValueUtil.getNullConstant();
                break;
            case ts.SyntaxKind.UndefinedKeyword:
                constant = ValueUtil.getUndefinedConst();
                break;
            case ts.SyntaxKind.TrueKeyword:
                constant = ValueUtil.getBooleanConstant(true);
                break;
            case ts.SyntaxKind.FalseKeyword:
                constant = ValueUtil.getBooleanConstant(false);
                break;
            default:
                logger.warn(`ast node's syntaxKind is ${ts.SyntaxKind[literalNode.kind]}, not literalNode`);
        }

        if (constant === null) {
            return null;
        }
        return {
            value: constant,
            valueOriginalPositions: [FullPosition.buildFromNode(literalNode, this.sourceFile)],
            stmts: [],
        };
    }

    private getOrCreatLocal(localName: string, localType: Type = UnknownType.getInstance()): Local {
        let local = this.locals.get(localName) || null;
        if (local == null) {
            local = new Local(localName, localType);
            this.locals.set(localName, local);
        }
        return local;
    }

    private generateTempLocal(localType: Type = UnknownType.getInstance()): Local {
        const tempLocalName = TEMP_LOCAL_PREFIX + this.tempLocalIndex;
        this.tempLocalIndex++;
        const tempLocal: Local = new Local(tempLocalName, localType);
        this.locals.set(tempLocalName, tempLocal);
        return tempLocal;
    }

    public generateAssignStmtForValue(value: Value, valueOriginalPositions: FullPosition[]): ValueAndStmts {
        const leftOp = this.generateTempLocal(value.getType());
        const leftOpPosition = valueOriginalPositions[0];
        const assignStmt = new ArkAssignStmt(leftOp, value);
        assignStmt.setOperandOriginalPositions([leftOpPosition, ...valueOriginalPositions]);
        return { value: leftOp, valueOriginalPositions: [leftOpPosition], stmts: [assignStmt] };
    }

    private isRelationalOperator(operator: BinaryOperator): boolean {
        return operator === RelationalBinaryOperator.LessThan ||
            operator === RelationalBinaryOperator.LessThanOrEqual ||
            operator === RelationalBinaryOperator.GreaterThan ||
            operator === RelationalBinaryOperator.GreaterThanOrEqual ||
            operator === RelationalBinaryOperator.Equality ||
            operator === RelationalBinaryOperator.InEquality ||
            operator === RelationalBinaryOperator.StrictEquality ||
            operator === RelationalBinaryOperator.StrictInequality;
    }

    private resolveTypeNode(type: ts.TypeNode): Type {
        const kind = type.kind;
        switch (kind) {
            case ts.SyntaxKind.BooleanKeyword:
                return BooleanType.getInstance();
            case ts.SyntaxKind.NumberKeyword:
                return NumberType.getInstance();
            case ts.SyntaxKind.StringKeyword:
                return StringType.getInstance();
            case ts.SyntaxKind.UndefinedKeyword:
                return UndefinedType.getInstance();
            case ts.SyntaxKind.AnyKeyword:
                return AnyType.getInstance();
            case ts.SyntaxKind.VoidKeyword:
                return VoidType.getInstance();
            case ts.SyntaxKind.NeverKeyword:
                return NeverType.getInstance();
            case ts.SyntaxKind.TypeReference:
                return this.resolveTypeReferenceNode(type as ts.TypeReferenceNode);
            case ts.SyntaxKind.ArrayType:
                return new ArrayType(this.resolveTypeNode((type as ts.ArrayTypeNode).elementType), 1);
            case ts.SyntaxKind.UnionType: {
                const cur = type as ts.UnionTypeNode;
                const mayTypes: Type[] = [];
                cur.types.forEach(t => mayTypes.push(this.resolveTypeNode(t)));
                return new UnionType(mayTypes);
            }
            case ts.SyntaxKind.TupleType: {
                const types: Type[] = [];
                (type as ts.TupleTypeNode).elements.forEach(element => {
                    types.push(this.resolveTypeNode(element));
                });
                return new TupleType(types);
            }
            case ts.SyntaxKind.NamedTupleMember:
                return this.resolveTypeNode((type as ts.NamedTupleMember).type);
            case ts.SyntaxKind.LiteralType:
                return this.resolveLiteralTypeNode(type as ts.LiteralTypeNode);
            case ts.SyntaxKind.TemplateLiteralType:
                return this.resolveTemplateLiteralTypeNode(type as ts.TemplateLiteralTypeNode);
            case ts.SyntaxKind.TypeLiteral:
                return this.resolveTypeLiteralNode(type as ts.TypeLiteralNode);
            case ts.SyntaxKind.FunctionType:
                return this.resolveFunctionTypeNode(type as ts.FunctionTypeNode);
            default:
                ;
        }
        return UnknownType.getInstance();
    }

    private resolveLiteralTypeNode(literalTypeNode: ts.LiteralTypeNode): Type {
        const literal = literalTypeNode.literal;
        const kind = literal.kind;
        switch (kind) {
            case ts.SyntaxKind.NullKeyword:
                return NullType.getInstance();
            case ts.SyntaxKind.TrueKeyword:
                return LiteralType.TRUE;
            case ts.SyntaxKind.FalseKeyword:
                return LiteralType.FALSE;
            case ts.SyntaxKind.NumericLiteral:
                return new LiteralType(parseFloat((literal as ts.NumericLiteral).text));
            case ts.SyntaxKind.PrefixUnaryExpression:
                return new LiteralType(parseFloat(literal.getText(this.sourceFile)));
            default:
                ;
        }
        return new LiteralType(literal.getText(this.sourceFile));
    }

    private resolveTemplateLiteralTypeNode(templateLiteralTypeNode: ts.TemplateLiteralTypeNode): Type {
        let stringLiterals: string[] = [''];
        const headString = templateLiteralTypeNode.head.rawText || '';
        let newStringLiterals: string[] = [];
        for (const stringLiteral of stringLiterals) {
            newStringLiterals.push(stringLiteral + headString);
        }
        stringLiterals = newStringLiterals;
        newStringLiterals = [];

        for (const templateSpan of templateLiteralTypeNode.templateSpans) {
            const templateType = this.resolveTypeNode(templateSpan.type);
            const unfoldTemplateTypes: Type[] = [];
            if (templateType instanceof UnionType) {
                unfoldTemplateTypes.push(...templateType.getTypes());
            } else {
                unfoldTemplateTypes.push(templateType);
            }
            const unfoldTemplateTypeStrs: string[] = [];
            for (const unfoldTemplateType of unfoldTemplateTypes) {
                unfoldTemplateTypeStrs.push(unfoldTemplateType instanceof AliasType ? unfoldTemplateType.getOriginalType().toString() : unfoldTemplateType.toString());
            }

            const templateSpanString = templateSpan.literal.rawText || '';
            for (const stringLiteral of stringLiterals) {
                for (const unfoldTemplateTypeStr of unfoldTemplateTypeStrs) {
                    newStringLiterals.push(stringLiteral + unfoldTemplateTypeStr + templateSpanString);
                }
            }
            stringLiterals = newStringLiterals;
            newStringLiterals = [];
        }

        const templateTypes: Type[] = [];
        for (const stringLiteral of stringLiterals) {
            templateTypes.push(new LiteralType(stringLiteral));
        }
        if (templateTypes.length > 0) {
            return new UnionType(templateTypes);
        }
        return templateTypes[0];
    }

    private resolveTypeReferenceNode(typeReferenceNode: ts.TypeReferenceNode): Type {
        const typeReferenceFullName = typeReferenceNode.getText(this.sourceFile);
        const aliasTypeAndPosition = this.aliasTypeMap.get(typeReferenceFullName);
        if (!aliasTypeAndPosition) {
            const genericTypes: Type[] = [];
            if (typeReferenceNode.typeArguments) {
                for (const typeArgument of typeReferenceNode.typeArguments) {
                    genericTypes.push(this.resolveTypeNode(typeArgument));
                }
            }

            // TODO:handle ts.QualifiedName
            const typeNameNode = typeReferenceNode.typeName;
            const typeName = typeNameNode.getText(this.sourceFile);
            return new UnclearReferenceType(typeName, genericTypes);
        } else {
            return aliasTypeAndPosition[0];
        }
    }

    private resolveTypeLiteralNode(typeLiteralNode: ts.TypeLiteralNode): Type {
        const anonymousClass = new ArkClass();
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        const declaringNamespace = declaringClass.getDeclaringArkNamespace();
        if (declaringNamespace) {
            buildNormalArkClassFromArkNamespace(typeLiteralNode, declaringNamespace, anonymousClass, this.sourceFile);
        } else {
            buildNormalArkClassFromArkFile(typeLiteralNode, declaringClass.getDeclaringArkFile(), anonymousClass, this.sourceFile);
        }
        return new ClassType(anonymousClass.getSignature());
    }

    private resolveFunctionTypeNode(functionTypeNode: ts.FunctionTypeNode): Type {
        const anonymousMethod = new ArkMethod();
        const declaringClass = this.declaringMethod.getDeclaringArkClass();
        buildArkMethodFromArkClass(functionTypeNode, declaringClass, anonymousMethod, this.sourceFile);
        return new FunctionType(anonymousMethod.getSignature());
    }

    private isLiteralNode(node: ts.Node): boolean {
        if (ts.isStringLiteral(node) ||
            ts.isNumericLiteral(node) ||
            ts.isBigIntLiteral(node) ||
            ts.isRegularExpressionLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            node.kind === ts.SyntaxKind.NullKeyword ||
            node.kind === ts.SyntaxKind.TrueKeyword ||
            node.kind === ts.SyntaxKind.FalseKeyword ||
            node.kind === ts.SyntaxKind.UndefinedKeyword) {
            return true;
        }
        return false;
    }

    public mapStmtsToTsStmt(stmts: Stmt[], node: ts.Node): void {
        for (const stmt of stmts) {
            if (!this.stmtsHaveOriginalText.has(stmt)) {
                this.stmtsHaveOriginalText.add(stmt);
                stmt.setOriginPositionInfo(LineColPosition.buildFromNode(node, this.sourceFile));
                stmt.setOriginalText(node.getText(this.sourceFile));
            }
        }
    }

    public static tokenToUnaryOperator(token: ts.SyntaxKind): UnaryOperator | null {
        switch (token) {
            case ts.SyntaxKind.MinusToken:
                return UnaryOperator.Neg;
            case ts.SyntaxKind.TildeToken:
                return UnaryOperator.BitwiseNot;
            case ts.SyntaxKind.ExclamationToken:
                return UnaryOperator.LogicalNot;
            default:
                ;
        }
        return null;
    }

    public static tokenToBinaryOperator(token: ts.SyntaxKind): BinaryOperator | null {
        switch (token) {
            case ts.SyntaxKind.QuestionQuestionToken:
                return NormalBinaryOperator.NullishCoalescing;
            case ts.SyntaxKind.AsteriskAsteriskToken:
                return NormalBinaryOperator.Exponentiation;
            case ts.SyntaxKind.SlashToken:
                return NormalBinaryOperator.Division;
            case ts.SyntaxKind.PlusToken:
                return NormalBinaryOperator.Addition;
            case ts.SyntaxKind.MinusToken:
                return NormalBinaryOperator.Subtraction;
            case ts.SyntaxKind.AsteriskToken:
                return NormalBinaryOperator.Multiplication;
            case ts.SyntaxKind.PercentToken:
                return NormalBinaryOperator.Remainder;
            case ts.SyntaxKind.LessThanLessThanToken:
                return NormalBinaryOperator.LeftShift;
            case ts.SyntaxKind.GreaterThanGreaterThanToken:
                return NormalBinaryOperator.RightShift;
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                return NormalBinaryOperator.UnsignedRightShift;
            case ts.SyntaxKind.AmpersandToken:
                return NormalBinaryOperator.BitwiseAnd;
            case ts.SyntaxKind.BarToken:
                return NormalBinaryOperator.BitwiseOr;
            case ts.SyntaxKind.CaretToken:
                return NormalBinaryOperator.BitwiseXor;
            case ts.SyntaxKind.AmpersandAmpersandToken:
                return NormalBinaryOperator.LogicalAnd;
            case ts.SyntaxKind.BarBarToken:
                return NormalBinaryOperator.LogicalOr;
            case ts.SyntaxKind.LessThanToken:
                return RelationalBinaryOperator.LessThan;
            case ts.SyntaxKind.LessThanEqualsToken:
                return RelationalBinaryOperator.LessThanOrEqual;
            case ts.SyntaxKind.GreaterThanToken:
                return RelationalBinaryOperator.GreaterThan;
            case ts.SyntaxKind.GreaterThanEqualsToken:
                return RelationalBinaryOperator.GreaterThanOrEqual;
            case ts.SyntaxKind.EqualsEqualsToken:
                return RelationalBinaryOperator.Equality;
            case ts.SyntaxKind.ExclamationEqualsToken:
                return RelationalBinaryOperator.InEquality;
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                return RelationalBinaryOperator.StrictEquality;
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                return RelationalBinaryOperator.StrictInequality;
            default:
                ;
        }
        return null;
    }
}