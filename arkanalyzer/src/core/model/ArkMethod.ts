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

import { ArkParameterRef, ArkThisRef } from '../base/Ref';
import { ArkAssignStmt, ArkReturnStmt, Stmt } from '../base/Stmt';
import { ClassType, FunctionType, GenericType, NumberType, Type, UnionType } from '../base/Type';
import { Value } from '../base/Value';
import { Cfg } from '../graph/Cfg';
import { ViewTree } from '../graph/ViewTree';
import { ArkBody } from './ArkBody';
import { ArkClass, ClassCategory } from './ArkClass';
import { MethodSignature } from './ArkSignature';
import { BodyBuilder } from '../common/BodyBuilder';
import { ArkExport, ExportType } from './ArkExport';
import { ANONYMOUS_METHOD_PREFIX, DEFAULT_ARK_METHOD_NAME } from '../common/Const';
import { getColNo, getLineNo, LineCol, setCol, setLine } from '../base/Position';
import { ArkBaseModel } from './ArkBaseModel';
import { ArkError, ArkErrorCode } from '../common/ArkError';
import { CALL_BACK } from '../common/EtsConst';
import { Scene } from '../../Scene';

export const arkMethodNodeKind = ['MethodDeclaration', 'Constructor', 'FunctionDeclaration', 'GetAccessor',
    'SetAccessor', 'ArrowFunction', 'FunctionExpression', 'MethodSignature', 'ConstructSignature', 'CallSignature'];

/**
 * @category core/model
 */
export class ArkMethod extends ArkBaseModel implements ArkExport {
    private code?: string;
    private declaringArkClass!: ArkClass;

    private genericTypes?: GenericType[];

    private methodDeclareSignatures?: MethodSignature[];
    private methodDeclareLineCols?: LineCol[];

    private methodSignature?: MethodSignature;
    private lineCol?: LineCol;

    private body?: ArkBody;
    private viewTree?: ViewTree;

    private bodyBuilder?: BodyBuilder;

    private isGeneratedFlag: boolean = false;
    private asteriskToken: boolean = false;

    constructor() {
        super();
    }

    getExportType(): ExportType {
        return ExportType.METHOD;
    }

    public getName() {
        return this.getSignature().getMethodSubSignature().getMethodName();
    }

    /**
     * Returns the codes of method as a **string.**
     * @returns the codes of method.
     */
    public getCode() {
        return this.code;
    }

    public setCode(code: string) {
        this.code = code;
    }

    /**
     * Get all lines of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the lines of the method's declarations with number type.
     */
    public getDeclareLines(): number[] | null {
        if (this.methodDeclareLineCols === undefined) {
            return null;
        }
        let lines: number[] = [];
        this.methodDeclareLineCols.forEach(lineCol => {
            lines.push(getLineNo(lineCol));
        });
        return lines;
    }

    /**
     * Get all columns of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the columns of the method's declarations with number type.
     */
    public getDeclareColumns(): number[] | null {
        if (this.methodDeclareLineCols === undefined) {
            return null;
        }
        let columns: number[] = [];
        this.methodDeclareLineCols.forEach(lineCol => {
            columns.push(getColNo(lineCol));
        });
        return columns;
    }

    /**
     * Set lines and columns of the declarations with number type inputs and then encoded them to LineCol type.
     * The length of lines and columns should be the same otherwise they cannot be encoded together.
     * @param lines - the number of lines.
     * @param columns - the number of columns.
     * @returns
     */
    public setDeclareLinesAndCols(lines: number[], columns: number[]): void {
        if (lines?.length !== columns?.length) {
            return;
        }
        this.methodDeclareLineCols = [];
        lines.forEach((line, index) => {
            let lineCol: LineCol = 0;
            lineCol = setLine(lineCol, line);
            lineCol = setCol(lineCol, columns[index]);
            (this.methodDeclareLineCols as LineCol[]).push(lineCol);
        });
    }

    /**
     * Set lineCols of the declarations directly with LineCol type input.
     * @param lineCols - the encoded lines and columns with LineCol type.
     * @returns
     */
    public setDeclareLineCols(lineCols: LineCol[]): void {
        this.methodDeclareLineCols = lineCols;
    }

    /**
     * Get encoded lines and columns of the method's declarations or null if the method has no seperated declaration.
     * @returns null or the encoded lines and columns of the method's declarations with LineCol type.
     */
    public getDeclareLineCols(): LineCol[] | null {
        return this.methodDeclareLineCols ?? null;
    }

    /**
     * Get line of the method's implementation or null if the method has no implementation.
     * @returns null or the number of the line.
     */
    public getLine(): number | null {
        if (this.lineCol === undefined) {
            return null;
        }
        return getLineNo(this.lineCol);
    }

    /**
     * Set line of the implementation with line number input.
     * The line number will be encoded together with the original column number.
     * @param line - the line number of the method implementation.
     * @returns
     */
    public setLine(line: number): void {
        if (this.lineCol === undefined) {
            this.lineCol = 0;
        }
        this.lineCol = setLine(this.lineCol, line);
    }

    /**
     * Get column of the method's implementation or null if the method has no implementation.
     * @returns null or the number of the column.
     */
    public getColumn(): number | null {
        if (this.lineCol === undefined) {
            return null;
        }
        return getColNo(this.lineCol);
    }

    /**
     * Set column of the implementation with column number input.
     * The column number will be encoded together with the original line number.
     * @param column - the column number of the method implementation.
     * @returns
     */
    public setColumn(column: number): void {
        if (this.lineCol === undefined) {
            this.lineCol = 0;
        }
        this.lineCol = setCol(this.lineCol, column);
    }

    /**
     * Get encoded line and column of the method's implementation or null if the method has no implementation.
     * @returns null or the encoded line and column of the method's implementation with LineCol type.
     */
    public getLineCol(): LineCol | null {
        return this.lineCol ?? null;
    }

    /**
     * Set lineCol of the implementation directly with LineCol type input.
     * @param lineCol - the encoded line and column with LineCol type.
     * @returns
     */
    public setLineCol(lineCol: LineCol): void {
        this.lineCol = lineCol;
    }

    /**
     * Returns the declaring class of the method.
     * @returns The declaring class of the method.
     */
    public getDeclaringArkClass() {
        return this.declaringArkClass;
    }

    public setDeclaringArkClass(declaringArkClass: ArkClass) {
        this.declaringArkClass = declaringArkClass;
    }

    public getDeclaringArkFile() {
        return this.declaringArkClass.getDeclaringArkFile();
    }

    public isDefaultArkMethod(): boolean {
        return this.getName() === DEFAULT_ARK_METHOD_NAME;
    }

    public isAnonymousMethod(): boolean {
        return this.getName().startsWith(ANONYMOUS_METHOD_PREFIX);
    }

    public getParameters() {
        return this.getSignature().getMethodSubSignature().getParameters();
    }

    public getReturnType() {
        return this.getSignature().getType();
    }

    /**
     * Get all declare signatures.
     * The results could be null if there is no seperated declaration of the method.
     * @returns null or the method declare signatures.
     */
    public getDeclareSignatures(): MethodSignature[] | null {
        return this.methodDeclareSignatures ?? null;
    }

    /**
     * Get the index of the matched method declare signature among all declare signatures.
     * The index will be -1 if there is no matched signature found.
     * @param targetSignature - the target declare signature want to search.
     * @returns -1 or the index of the matched signature.
     */
    public getDeclareSignatureIndex(targetSignature: MethodSignature): number {
        let declareSignatures = this.methodDeclareSignatures;
        if (declareSignatures === undefined) {
            return -1;
        }
        for (let i = 0; i < declareSignatures.length; i++) {
            if (declareSignatures[i].isMatch(targetSignature)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Get the method signature of the implementation.
     * The signature could be null if the method is only a declaration which body is undefined.
     * @returns null or the method implementation signature.
     */
    public getImplementationSignature(): MethodSignature | null {
        return this.methodSignature ?? null;
    }

    /**
     * Get the method signature of the implementation or the first declaration if there is no implementation.
     * For a method, the implementation and declaration signatures must not be undefined at the same time.
     * A {@link MethodSignature} includes:
     * - Class Signature: indicates which class this method belong to.
     * - Method SubSignature: indicates the detail info of this method such as method name, parameters, returnType, etc.
     * @returns The method signature.
     * @example
     * 1. Get the signature of method mtd.

     ```typescript
     let signature = mtd.getSignature();
     // ... ...
     ```
     */
    public getSignature(): MethodSignature {
        return this.methodSignature ?? (this.methodDeclareSignatures as MethodSignature[])[0];
    }

    /**
     * Set signatures of all declarations.
     * It will reset the declaration signatures if they are already defined before.
     * @param signatures - one signature or a list of signatures.
     * @returns
     */
    public setDeclareSignatures(signatures: MethodSignature | MethodSignature[]): void {
        if (Array.isArray(signatures)) {
            this.methodDeclareSignatures = signatures;
        } else {
            this.methodDeclareSignatures = [signatures];
        }
    }

    /**
     * Reset signature of one declaration with the specified index.
     * Will do nothing if the index doesn't exist.
     * @param signature - new signature want to set.
     * @param index - index of signature want to set.
     * @returns
     */
    public setDeclareSignatureWithIndex(signature: MethodSignature, index: number): void {
        if (this.methodDeclareSignatures === undefined || this.methodDeclareSignatures.length <= index) {
            return;
        }
        this.methodDeclareSignatures[index] = signature;
    }

    /**
     * Set signature of implementation.
     * It will reset the implementation signature if it is already defined before.
     * @param signature - signature of implementation.
     * @returns
     */
    public setImplementationSignature(signature: MethodSignature): void {
        this.methodSignature = signature;
    }

    public getSubSignature() {
        return this.getSignature().getMethodSubSignature();
    }

    public getGenericTypes(): GenericType[] | undefined {
        return this.genericTypes;
    }

    public isGenericsMethod(): boolean {
        return this.genericTypes !== undefined;
    }

    public setGenericTypes(genericTypes: GenericType[]): void {
        this.genericTypes = genericTypes;
    }

    public getBodyBuilder(): BodyBuilder | undefined {
        return this.bodyBuilder;
    }

    /**
     * Get {@link ArkBody} of a Method.
     * A {@link ArkBody} contains the CFG and actual instructions or operations to be executed for a method.
     * It is analogous to the body of a function or method in high-level programming languages,
     * which contains the statements and expressions that define what the function does.
     * @returns The {@link ArkBody} of a method.
     * @example
     * 1. Get cfg or stmt through ArkBody.

     ```typescript
     let cfg = this.scene.getMethod()?.getBody().getCfg();
     const body = arkMethod.getBody()
     ```

     2. Get local variable through ArkBody.

     ```typescript
     arkClass.getDefaultArkMethod()?.getBody().getLocals.forEach(local=>{...})
     let locals = arkFile().getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals();
     ```
     */
    public getBody(): ArkBody | undefined {
        return this.body;
    }

    public setBody(body: ArkBody) {
        this.body = body;
    }

    /**
     * Get the CFG (i.e., control flow graph) of a method.
     * The CFG is a graphical representation of all possible control flow paths within a method's body.
     * A CFG consists of blocks, statements and goto control jumps.
     * @returns The CFG (i.e., control flow graph) of a method.
     * @example
     * 1. get stmt through ArkBody cfg.

     ```typescript
     body = arkMethod.getBody();
     const cfg = body.getCfg();
     for (const threeAddressStmt of cfg.getStmts()) {
     ... ...
     }
     ```

     2. get blocks through ArkBody cfg.

     ```typescript
     const body = arkMethod.getBody();
     const blocks = [...body.getCfg().getBlocks()];
     for (let i=0; i<blocks.length; i++) {
     const block = blocks[i];
     ... ...
     for (const stmt of block.getStmts()) {
     ... ...
     }
     let text = "next;"
     for (const next of block.getSuccessors()) {
     text += blocks.indexOf(next) + ' ';
     }
     // ... ...
     }
     ```
     */
    public getCfg(): Cfg | undefined {
        return this.body?.getCfg();
    }

    public getOriginalCfg(): Cfg | undefined {
        return undefined;
    }

    public getParameterInstances(): Value[] {
        // 获取方法体中参数Local实例
        let stmts: Stmt[] = [];
        if (this.getCfg()) {
            const cfg = this.getCfg() as Cfg;
            stmts.push(...cfg.getStmts());
        }
        let results: Value[] = [];
        for (let stmt of stmts) {
            if (stmt instanceof ArkAssignStmt) {
                if (stmt.getRightOp() instanceof ArkParameterRef) {
                    results.push((stmt as ArkAssignStmt).getLeftOp());
                }
            }
            if (results.length === this.getParameters().length) {
                return results;
            }
        }
        return results;
    }

    public getThisInstance(): Value | null {
        // 获取方法体中This实例
        let stmts: Stmt[] = [];
        if (this.getCfg()) {
            const cfg = this.getCfg() as Cfg;
            stmts.push(...cfg.getStmts());
        }
        for (let stmt of stmts) {
            if (stmt instanceof ArkAssignStmt) {
                if (stmt.getRightOp() instanceof ArkThisRef) {
                    return stmt.getLeftOp();
                }
            }
        }
        return null;
    }

    public getReturnValues(): Value[] {
        // 获取方法体中return值实例
        let resultValues: Value[] = [];
        let stmts: Stmt[] = [];
        if (this.getCfg()) {
            const cfg = this.getCfg() as Cfg;
            stmts.push(...cfg.getStmts());
        }
        for (let stmt of stmts) {
            if (stmt instanceof ArkReturnStmt) {
                resultValues.push(stmt.getOp());
            }
        }
        return resultValues;
    }

    public getReturnStmt(): Stmt[] {
        return this.getCfg()!.getStmts().filter(stmt => stmt instanceof ArkReturnStmt);
    }

    public setViewTree(viewTree: ViewTree) {
        this.viewTree = viewTree;
    }

    public getViewTree(): ViewTree | undefined {
        return this.viewTree;
    }

    public hasViewTree(): boolean {
        return this.viewTree !== undefined;
    }

    public setBodyBuilder(bodyBuilder: BodyBuilder) {
        this.bodyBuilder = bodyBuilder;
        if (this.getDeclaringArkFile().getScene().buildClassDone()) {
            this.buildBody();
        }
    }

    public buildBody() {
        if (this.bodyBuilder) {
            const arkBody: ArkBody | null = this.bodyBuilder.build();
            if (arkBody) {
                this.setBody(arkBody);
                arkBody.getCfg().setDeclaringMethod(this);

            }
            this.bodyBuilder = undefined;
        }
    }

    public isGenerated(): boolean {
        return this.isGeneratedFlag;
    }

    public setIsGeneratedFlag(isGeneratedFlag: boolean) {
        this.isGeneratedFlag = isGeneratedFlag;
    }

    public getAsteriskToken(): boolean {
        return this.asteriskToken;
    }

    public setAsteriskToken(asteriskToken: boolean) {
        this.asteriskToken = asteriskToken;
    }

    public validate(): ArkError {
        const declareSignatures = this.getDeclareSignatures();
        const declareLineCols = this.getDeclareLineCols();
        const signature = this.getImplementationSignature();
        const lineCol = this.getLineCol();

        if (declareSignatures === null && signature === null) {
            return {
                errCode: ArkErrorCode.METHOD_SIGNATURE_UNDEFINED,
                errMsg: 'methodDeclareSignatures and methodSignature are both undefined.'
            };
        }
        if ((declareSignatures === null) !== (declareLineCols === null)) {
            return {
                errCode: ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodDeclareSignatures and methodDeclareLineCols are not matched.'
            };
        }
        if (declareSignatures !== null && declareLineCols !== null && declareSignatures.length !== declareLineCols.length) {
            return {
                errCode: ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodDeclareSignatures and methodDeclareLineCols are not matched.'
            };
        }
        if ((signature === null) !== (lineCol === null)) {
            return {
                errCode: ArkErrorCode.METHOD_SIGNATURE_LINE_UNMATCHED,
                errMsg: 'methodSignature and lineCol are not matched.'
            };
        }
        return this.validateFields(['declaringArkClass']);
    }

    public matchMethodSignature(args: Type[]): MethodSignature {
        const signatures = this.methodDeclareSignatures?.filter(f => {
            const parameters = f.getMethodSubSignature().getParameters();
            const max = parameters.length;
            let min = 0;
            while (min < max && !parameters[min].isOptional()) {
                min++;
            }
            return args.length >= min && args.length <= max;
        });

        function match(paramType: Type, argType: Type, scene: Scene): boolean {
            if (paramType instanceof UnionType) {
                let matched = false;
                for (const e of paramType.getTypes()) {
                    if (argType.constructor === e.constructor) {
                        matched = true;
                        break;
                    }
                }
                return matched;
            } else if (argType instanceof FunctionType && paramType instanceof ClassType &&
                paramType.getClassSignature().getClassName().includes(CALL_BACK)) {
                return true;
            } else if (paramType instanceof NumberType && argType instanceof ClassType && ClassCategory.ENUM ===
                scene.getClass(argType.getClassSignature())?.getCategory()) {
                return true;
            }
            return argType.constructor === paramType.constructor;
        }

        const scene = this.getDeclaringArkFile().getScene();
        return signatures?.find(p => {
            const parameters = p.getMethodSubSignature().getParameters();
            for (let i = 0; i < parameters.length; i++) {
                if (!args[i]) {
                    return parameters[i].isOptional();
                }
                const paramType = parameters[i].getType();
                const argType = args[i];
                const isMatched = match(paramType, argType, scene);
                if (!isMatched) {
                    return false;
                }
            }
            return true;
        }) ?? signatures?.[0] ?? this.getSignature();
    }

}