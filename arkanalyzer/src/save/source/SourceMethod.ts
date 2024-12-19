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

import { UnknownType } from '../../core/base/Type';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ArkCodeBuffer } from '../ArkStream';
import { SourceBase } from './SourceBase';
import { SourceBody } from './SourceBody';
import { SourceStmt } from './SourceStmt';
import { SourceTransformer } from './SourceTransformer';
import { SourceUtils } from './SourceUtils';
import { Stmt } from '../../core/base/Stmt';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { ArkMetadataKind } from '../../core/model/ArkMetadata';

/**
 * @category save
 */
export class SourceMethod extends SourceBase {
    private method: ArkMethod;
    private transformer: SourceTransformer;

    public constructor(method: ArkMethod, indent: string = '') {
        super(method.getDeclaringArkFile(), indent);
        this.method = method;
        this.transformer = new SourceTransformer(this);
        this.inBuilder = this.initInBuilder();
    }

    public getDeclaringArkNamespace(): ArkNamespace | undefined {
        return this.method.getDeclaringArkClass().getDeclaringArkNamespace();
    }

    public setInBuilder(inBuilder: boolean): void {
        this.inBuilder = inBuilder;
    }

    public dump(): string {
        this.printer.clear();
        (this.method.getMetadata(ArkMetadataKind.LEADING_COMMENTS) || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });
        if (!this.method.isDefaultArkMethod()) {
            this.printMethod(this.method);
        } else {
            this.printBody(this.method);
        }
        return this.printer.toString();
    }

    public dumpOriginal(): string {
        return this.method.getCode() + '\n';
    }

    public getLine(): number {
        let line = this.method.getLine();
        if (line === null) {
            line = 0;
        }
        if (line > 0) {
            return line;
        }

        const stmts: Stmt[] = [];
        const cfg = this.method.getCfg();
        if (cfg) {
            stmts.push(...cfg.getStmts().reverse());
        }
        for (const stmt of stmts) {
            if (stmt.getOriginPositionInfo().getLineNo() > 0) {
                return stmt.getOriginPositionInfo().getLineNo();
            }
        }

        return line;
    }

    public dumpDefaultMethod(): SourceStmt[] {
        let srcBody = new SourceBody(this.printer.getIndent(), this.method, false);
        return srcBody.getStmts();
    }

    private printMethod(method: ArkMethod): void {
        this.printDecorator(method.getDecorators());
        this.printer.writeIndent().write(this.methodProtoToString(method));
        // abstract function no body
        if (!method.getBody()) {
            this.printer.writeLine(';');
            return;
        }

        this.printer.writeLine(' {');
        this.printer.incIndent();
        this.printBody(method);
        this.printer.decIndent();

        this.printer.writeIndent();
        if (SourceUtils.isAnonymousMethod(method.getName())) {
            this.printer.write('}');
        } else {
            this.printer.writeLine('}');
        }
    }

    private printBody(method: ArkMethod): void {
        let srcBody = new SourceBody(this.printer.getIndent(), method, this.inBuilder);
        this.printer.write(srcBody.dump());
    }

    protected methodProtoToString(method: ArkMethod): string {
        let code = new ArkCodeBuffer();
        code.writeSpace(this.modifiersToString(method.getModifiers()));
        if (!SourceUtils.isAnonymousMethod(method.getName())) {
            if (method.getDeclaringArkClass()?.isDefaultArkClass()) {
                code.writeSpace('function');
            }
            if (method.getAsteriskToken()) {
                code.writeSpace('*');
            }
            code.write(this.resolveMethodName(method.getName()));
        }
        const genericTypes = method.getGenericTypes();
        if (genericTypes && genericTypes.length > 0) {
            let
                typeParameters: string[] = [];
            genericTypes.forEach((genericType) => {
                typeParameters.push(this.transformer.typeToString(genericType));
            });
            code.write(`<${this.transformer.typeArrayToString(genericTypes)}>`);
        }

        let parameters: string[] = [];
        method.getParameters().forEach((parameter) => {
            let str: string = parameter.getName();
            if (parameter.hasDotDotDotToken()) {
                str = `...${parameter.getName()}`;
            }
            if (parameter.isOptional()) {
                str += '?';
            }
            if (parameter.getType()) {
                str += ': ' + this.transformer.typeToString(parameter.getType());
            }
            parameters.push(str);
        });
        code.write(`(${parameters.join(', ')})`);
        const returnType = method.getReturnType();
        if (method.getName() !== 'constructor' && !(returnType instanceof UnknownType)) {
            code.write(`: ${this.transformer.typeToString(returnType)}`);
        }
        if (SourceUtils.isAnonymousMethod(method.getName())) {
            code.write(' =>');
        }
        return code.toString();
    }

    public toArrowFunctionTypeString(): string {
        let code = new ArkCodeBuffer();

        let parameters: string[] = [];
        this.method.getParameters().forEach((parameter) => {
            let str: string = parameter.getName();
            if (parameter.isOptional()) {
                str += '?';
            }
            if (parameter.getType()) {
                str += ': ' + this.transformer.typeToString(parameter.getType());
            }
            parameters.push(str);
        });
        code.write(`(${parameters.join(', ')}) => `);
        const returnType = this.method.getReturnType();
        if (!(returnType instanceof UnknownType)) {
            code.writeSpace(`${this.transformer.typeToString(returnType)}`);
        }

        return code.toString();
    }

    private initInBuilder(): boolean {
        return (
            this.method.hasBuilderDecorator() ||
            ((this.method.getName() === 'build' || this.method.getName() === 'pageTransition') &&
                !this.method.isStatic() &&
                this.method.getDeclaringArkClass().hasViewTree())
        );
    }
}
