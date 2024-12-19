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

import { ClassType, Type, UnknownType } from '../../base/Type';
import { BodyBuilder } from '../../common/BodyBuilder';
import { buildViewTree } from '../../graph/builder/ViewTreeBuilder';
import { ArkClass, ClassCategory } from '../ArkClass';
import { ArkMethod } from '../ArkMethod';
import ts from 'ohos-typescript';
import {
    buildDecorators,
    buildGenericType,
    buildModifiers,
    buildParameters,
    buildReturnType,
    buildTypeParameters,
    handlePropertyAccessExpression,
} from './builderUtils';
import Logger, { LOG_MODULE_TYPE } from '../../../utils/logger';
import { ArkParameterRef, ArkThisRef } from '../../base/Ref';
import { ArkBody } from '../ArkBody';
import { Cfg } from '../../graph/Cfg';
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from '../../base/Expr';
import { MethodSignature, MethodSubSignature } from '../ArkSignature';
import { ArkAssignStmt, ArkInvokeStmt, ArkReturnVoidStmt, Stmt } from '../../base/Stmt';
import { BasicBlock } from '../../graph/BasicBlock';
import { Local } from '../../base/Local';
import { Value } from '../../base/Value';
import { CONSTRUCTOR_NAME, SUPER_NAME, THIS_NAME } from '../../common/TSConst';
import {
    ANONYMOUS_METHOD_PREFIX,
    CALL_SIGNATURE_NAME,
    DEFAULT_ARK_CLASS_NAME,
    DEFAULT_ARK_METHOD_NAME,
    NAME_DELIMITER,
    NAME_PREFIX,
} from '../../common/Const';
import { ArkSignatureBuilder } from './ArkSignatureBuilder';
import { IRUtils } from '../../common/IRUtils';
import { ArkErrorCode } from '../../common/ArkError';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'ArkMethodBuilder');

export type MethodLikeNode =
    ts.FunctionDeclaration |
    ts.MethodDeclaration |
    ts.ConstructorDeclaration |
    ts.ArrowFunction |
    ts.AccessorDeclaration |
    ts.FunctionExpression |
    ts.MethodSignature |
    ts.ConstructSignatureDeclaration |
    ts.CallSignatureDeclaration |
    ts.FunctionTypeNode;

export function buildDefaultArkMethodFromArkClass(declaringClass: ArkClass, mtd: ArkMethod,
                                                  sourceFile: ts.SourceFile, node?: ts.ModuleDeclaration) {
    mtd.setDeclaringArkClass(declaringClass);

    const methodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(DEFAULT_ARK_METHOD_NAME, true);
    const methodSignature = new MethodSignature(mtd.getDeclaringArkClass().getSignature(), methodSubSignature);
    mtd.setImplementationSignature(methodSignature);
    mtd.setLineCol(0);

    const defaultMethodNode = node ? node : sourceFile;

    let bodyBuilder = new BodyBuilder(mtd.getSignature(), defaultMethodNode, mtd, sourceFile);
    mtd.setBodyBuilder(bodyBuilder);
}

export function buildArkMethodFromArkClass(methodNode: MethodLikeNode, declaringClass: ArkClass, mtd: ArkMethod, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod) {

    mtd.setDeclaringArkClass(declaringClass);

    if (ts.isFunctionDeclaration(methodNode)) {
        mtd.setAsteriskToken(methodNode.asteriskToken !== undefined);
    }

    mtd.setCode(methodNode.getText(sourceFile));


    mtd.setModifiers(buildModifiers(methodNode));
    mtd.setDecorators(buildDecorators(methodNode, sourceFile));

    if (methodNode.typeParameters) {
        mtd.setGenericTypes(buildTypeParameters(methodNode.typeParameters, sourceFile, mtd));
    }

    // build methodDeclareSignatures and methodSignature as well as corresponding positions
    const methodName = buildMethodName(methodNode, declaringClass, sourceFile, declaringMethod);
    const methodParameters: MethodParameter[] = [];
    buildParameters(methodNode.parameters, mtd, sourceFile).forEach((parameter) => {
        methodParameters.push(parameter);
    });
    let returnType = UnknownType.getInstance();
    if (methodNode.type) {
        returnType = buildGenericType(buildReturnType(methodNode.type, sourceFile, mtd), mtd);
    }
    const methodSubSignature = new MethodSubSignature(methodName, methodParameters, returnType, mtd.isStatic());
    const methodSignature = new MethodSignature(mtd.getDeclaringArkClass().getSignature(), methodSubSignature);
    const { line, character } = ts.getLineAndCharacterOfPosition(
        sourceFile,
        methodNode.getStart(sourceFile),
    );
    if (isMethodImplementation(methodNode)) {
        mtd.setImplementationSignature(methodSignature);
        mtd.setLine(line + 1);
        mtd.setColumn(character + 1);
    } else {
        mtd.setDeclareSignatures(methodSignature);
        mtd.setDeclareLinesAndCols([line + 1], [character + 1]);
    }

    let bodyBuilder = new BodyBuilder(mtd.getSignature(), methodNode, mtd, sourceFile);
    mtd.setBodyBuilder(bodyBuilder);

    if (mtd.hasBuilderDecorator()) {
        mtd.setViewTree(buildViewTree(mtd));
    } else if (declaringClass.hasComponentDecorator() &&
        mtd.getSubSignature().toString() === 'build()' &&
        !mtd.isStatic()) {
        declaringClass.setViewTree(buildViewTree(mtd));
    }
    checkAndUpdateMethod(mtd, declaringClass);
    declaringClass.addMethod(mtd);
    IRUtils.setLeadingComments(mtd, methodNode, sourceFile, mtd.getDeclaringArkFile().getScene().getOptions());
}

function buildMethodName(node: MethodLikeNode, declaringClass: ArkClass, sourceFile: ts.SourceFile, declaringMethod?: ArkMethod): string {
    let name: string = '';
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
        name = node.name ? node.name.text : buildAnonymousMethodName(node, declaringClass);
    } else if (ts.isFunctionTypeNode(node)) {
        //TODO: check name type
        name = node.name ? node.name.getText(sourceFile) : buildAnonymousMethodName(node, declaringClass);
    } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
        if (ts.isIdentifier(node.name)) {
            name = (node.name as ts.Identifier).text;
        } else if (ts.isComputedPropertyName(node.name)) {
            if (ts.isIdentifier(node.name.expression)) {
                name = node.name.expression.text;
            } else if (ts.isPropertyAccessExpression(node.name.expression)) {
                name = handlePropertyAccessExpression(node.name.expression);
            } else {
                logger.warn('Other method ComputedPropertyName found!');
            }
        } else {
            logger.warn('Other method declaration type found!');
        }
    }
    //TODO, hard code
    else if (ts.isConstructorDeclaration(node)) {
        name = CONSTRUCTOR_NAME;
    } else if (ts.isConstructSignatureDeclaration(node)) {
        name = 'construct-signature';
    } else if (ts.isCallSignatureDeclaration(node)) {
        name = CALL_SIGNATURE_NAME;
    } else if (ts.isGetAccessor(node) && ts.isIdentifier(node.name)) {
        name = 'Get-' + node.name.text;
    } else if (ts.isSetAccessor(node) && ts.isIdentifier(node.name)) {
        name = 'Set-' + node.name.text;
    } else if (ts.isArrowFunction(node)) {
        name = buildAnonymousMethodName(node, declaringClass);
    }

    if (declaringMethod !== undefined && !declaringMethod.isDefaultArkMethod()) {
        name = buildNestedMethodName(name, declaringMethod.getName());
    }
    return name;
}

function buildAnonymousMethodName(node: MethodLikeNode, declaringClass: ArkClass) {
    return `${ANONYMOUS_METHOD_PREFIX}${declaringClass.getAnonymousMethodNumber()}`;
}

function buildNestedMethodName(originName: string, declaringMethodName: string): string {
    if (originName.startsWith(NAME_PREFIX)) {
        return `${originName}${NAME_DELIMITER}${declaringMethodName}`;
    }
    return `${NAME_PREFIX}${originName}${NAME_DELIMITER}${declaringMethodName}`;
}

export class ObjectBindingPatternParameter {
    private propertyName: string = '';
    private name: string = '';
    private optional: boolean = false;

    constructor() {
    }

    public getName() {
        return this.name;
    }

    public setName(name: string) {
        this.name = name;
    }

    public getPropertyName() {
        return this.propertyName;
    }

    public setPropertyName(propertyName: string) {
        this.propertyName = propertyName;
    }

    public isOptional() {
        return this.optional;
    }

    public setOptional(optional: boolean) {
        this.optional = optional;
    }
}

export class ArrayBindingPatternParameter {
    private propertyName: string = '';
    private name: string = '';
    private optional: boolean = false;

    constructor() {
    }

    public getName() {
        return this.name;
    }

    public setName(name: string) {
        this.name = name;
    }

    public getPropertyName() {
        return this.propertyName;
    }

    public setPropertyName(propertyName: string) {
        this.propertyName = propertyName;
    }

    public isOptional() {
        return this.optional;
    }

    public setOptional(optional: boolean) {
        this.optional = optional;
    }
}

export class MethodParameter {
    private name: string = '';
    private type!: Type;
    private optional: boolean = false;
    private dotDotDotToken: boolean = false;
    private objElements: ObjectBindingPatternParameter[] = [];
    private arrayElements: ArrayBindingPatternParameter[] = [];

    constructor() {
    }

    public getName() {
        return this.name;
    }

    public setName(name: string) {
        this.name = name;
    }

    public getType() {
        return this.type;
    }

    public setType(type: Type) {
        this.type = type;
    }

    public isOptional() {
        return this.optional;
    }

    public setOptional(optional: boolean) {
        this.optional = optional;
    }

    public hasDotDotDotToken() {
        return this.dotDotDotToken;
    }

    public setDotDotDotToken(dotDotDotToken: boolean) {
        this.dotDotDotToken = dotDotDotToken;
    }

    public addObjElement(element: ObjectBindingPatternParameter) {
        this.objElements.push(element);
    }

    public getObjElements() {
        return this.objElements;
    }

    public setObjElements(objElements: ObjectBindingPatternParameter[]) {
        this.objElements = objElements;
    }

    public addArrayElement(element: ArrayBindingPatternParameter) {
        this.arrayElements.push(element);
    }

    public getArrayElements() {
        return this.arrayElements;
    }

    public setArrayElements(arrayElements: ArrayBindingPatternParameter[]) {
        this.arrayElements = arrayElements;
    }
}

function needDefaultConstructorInClass(arkClass: ArkClass): boolean {
    const originClassType = arkClass.getCategory();
    return arkClass.getMethodWithName(CONSTRUCTOR_NAME) == null &&
        (originClassType === ClassCategory.CLASS || originClassType === ClassCategory.OBJECT) &&
        arkClass.getName() !== DEFAULT_ARK_CLASS_NAME &&
        !arkClass.isDeclare();
}

export function buildDefaultConstructor(arkClass: ArkClass): boolean {
    if (!needDefaultConstructorInClass(arkClass)) {
        return false;
    }

    let parentConstructor: ArkMethod | null = null;
    let superClass: ArkClass | null = arkClass.getSuperClass() || null;
    while (superClass != null) {
        parentConstructor = superClass.getMethodWithName(CONSTRUCTOR_NAME);
        if (parentConstructor != null) {
            break;
        }
        superClass = superClass.getSuperClass() || null;
    }

    const defaultConstructor: ArkMethod = new ArkMethod();
    defaultConstructor.setDeclaringArkClass(arkClass);
    defaultConstructor.setCode('');
    defaultConstructor.setIsGeneratedFlag(true);

    const thisLocal = new Local(THIS_NAME);
    const locals: Set<Local> = new Set([thisLocal]);
    const basicBlock = new BasicBlock();
    let startingStmt: Stmt = new ArkAssignStmt(thisLocal, new ArkThisRef(new ClassType(arkClass.getSignature())));
    basicBlock.addStmt(startingStmt);
    if (parentConstructor != null) {
        const methodParameters: MethodParameter[] = [];
        parentConstructor.getParameters().forEach(parameter => {
            methodParameters.push(parameter);
        });
        let returnType = parentConstructor.getReturnType();
        const methodSubSignature = new MethodSubSignature(CONSTRUCTOR_NAME, methodParameters, returnType,
            defaultConstructor.isStatic());
        const methodSignature = new MethodSignature(defaultConstructor.getDeclaringArkClass().getSignature(),
            methodSubSignature);
        defaultConstructor.setImplementationSignature(methodSignature);
        defaultConstructor.setLineCol(0);

        const stmts: Stmt[] = [];
        let index = 0;
        const parameterLocals: Value[] = [];
        for (const methodParameter of defaultConstructor.getParameters()) {
            const parameterRef = new ArkParameterRef(index, methodParameter.getType());
            const parameterLocal = new Local(methodParameter.getName(), parameterRef.getType());
            locals.add(parameterLocal);
            parameterLocals.push(parameterLocal);
            stmts.push(new ArkAssignStmt(parameterLocal, parameterRef));
            index++;
        }

        const superMethodSubSignature = new MethodSubSignature(SUPER_NAME, parentConstructor.getParameters(),
            defaultConstructor.getReturnType());
        const superMethodSignature = new MethodSignature(arkClass.getSignature(), superMethodSubSignature);

        const superInvokeExpr = new ArkStaticInvokeExpr(superMethodSignature, parameterLocals);
        const superInvokeStmt = new ArkInvokeStmt(superInvokeExpr);
        basicBlock.addStmt(superInvokeStmt);
        const returnVoidStmt = new ArkReturnVoidStmt();
        basicBlock.addStmt(returnVoidStmt);
    } else {
        const methodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName(CONSTRUCTOR_NAME);
        const methodSignature = new MethodSignature(defaultConstructor.getDeclaringArkClass().getSignature(),
            methodSubSignature);
        defaultConstructor.setImplementationSignature(methodSignature);
        defaultConstructor.setLineCol(0);

        if (arkClass.getSuperClass()) {
            const superClass = arkClass.getSuperClass() as ArkClass;
            const superMethodSubSignature = new MethodSubSignature(SUPER_NAME, [], UnknownType.getInstance());
            const superMethodSignature = new MethodSignature(superClass.getSignature(), superMethodSubSignature);
            const superInvokeExpr = new ArkStaticInvokeExpr(superMethodSignature, []);
            const superInvokeStmt = new ArkInvokeStmt(superInvokeExpr);
            basicBlock.addStmt(superInvokeStmt);
            const returnVoidStmt = new ArkReturnVoidStmt();
            basicBlock.addStmt(returnVoidStmt);
        } else {
            const returnVoidStmt = new ArkReturnVoidStmt();
            basicBlock.addStmt(returnVoidStmt);
        }

    }
    const cfg = new Cfg();
    cfg.addBlock(basicBlock);
    cfg.setStartingStmt(startingStmt);
    cfg.setDeclaringMethod(defaultConstructor);
    cfg.getStmts().forEach(s => s.setCfg(cfg));

    defaultConstructor.setBody(new ArkBody(locals, cfg));
    checkAndUpdateMethod(defaultConstructor, arkClass);
    arkClass.addMethod(defaultConstructor);

    return true;
}

export function buildInitMethod(initMethod: ArkMethod, fieldInitializerStmts: Stmt[], thisLocal: Local): void {
    const classType = new ClassType(initMethod.getDeclaringArkClass().getSignature());
    const assignStmt = new ArkAssignStmt(thisLocal, new ArkThisRef(classType));
    const block = new BasicBlock();
    block.addStmt(assignStmt);
    const locals: Set<Local> = new Set();
    for (const stmt of fieldInitializerStmts) {
        block.addStmt(stmt);
        if (stmt.getDef() && stmt.getDef() instanceof Local) {
            locals.add(stmt.getDef() as Local);
        }
    }
    block.addStmt(new ArkReturnVoidStmt());
    const cfg = new Cfg();
    cfg.addBlock(block);
    for (const stmt of block.getStmts()) {
        stmt.setCfg(cfg);
    }
    cfg.setStartingStmt(assignStmt);
    cfg.buildDefUseStmt();
    cfg.setDeclaringMethod(initMethod);
    initMethod.setBody(new ArkBody(locals, cfg));
}

export function addInitInConstructor(arkClass: ArkClass) {
    for (const method of arkClass.getMethods(true)) {
        if (method.getName() === CONSTRUCTOR_NAME) {
            const thisLocal = method.getBody()?.getLocals().get(THIS_NAME);
            if (!thisLocal) {
                continue;
            }
            const initInvokeStmt = new ArkInvokeStmt(new ArkInstanceInvokeExpr(thisLocal, arkClass.getInstanceInitMethod().getSignature(), []));
            const blocks = method.getCfg()?.getBlocks();
            if (!blocks) {
                continue;
            }
            const firstBlockStmts = [...blocks][0].getStmts();
            let index = 0;
            if (firstBlockStmts[0].getDef() instanceof Local && (firstBlockStmts[0].getDef() as Local).getName() === THIS_NAME) {
                index = 1;
            }
            firstBlockStmts.splice(index, 0, initInvokeStmt);
        }
    }
}

export function isMethodImplementation(node: MethodLikeNode): boolean {
    if (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isFunctionExpression(node)) {
        if (node.body !== undefined) {
            return true;
        }
    }
    return false;
}

export function checkAndUpdateMethod(method: ArkMethod, cls: ArkClass): void {
    let presentMethod: ArkMethod | null;
    if (method.isStatic()) {
        presentMethod = cls.getStaticMethodWithName(method.getName());
    } else {
        presentMethod = cls.getMethodWithName(method.getName());
    }
    if (presentMethod === null) {
        return;
    }

    if (method.validate().errCode !== ArkErrorCode.OK || presentMethod.validate().errCode !== ArkErrorCode.OK) {
        return;
    }
    const presentDeclareSignatures = presentMethod.getDeclareSignatures();
    const presentDeclareLineCols = presentMethod.getDeclareLineCols();
    const presentImplSignature = presentMethod.getImplementationSignature();
    const newDeclareSignature = method.getDeclareSignatures();
    const newDeclareLineCols = method.getDeclareLineCols();
    const newImplSignature = method.getImplementationSignature();

    if (presentDeclareSignatures !== null && presentImplSignature === null) {
        if (newDeclareSignature === null || presentMethod.getDeclareSignatureIndex(newDeclareSignature[0]) >= 0) {
            method.setDeclareSignatures(presentDeclareSignatures);
            method.setDeclareLineCols((presentDeclareLineCols as number[]));
        } else {
            method.setDeclareSignatures(presentDeclareSignatures.concat(newDeclareSignature));
            method.setDeclareLineCols((presentDeclareLineCols as number[]).concat(newDeclareLineCols as number[]));
        }
        return;
    }
    if (presentDeclareSignatures === null && presentImplSignature !== null) {
        if (newImplSignature === null) {
            method.setImplementationSignature(presentImplSignature);
            method.setLineCol(presentMethod.getLineCol() as number);
        }
        return;
    }
}

