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

import { ArkClass, ClassCategory } from '../../core/model/ArkClass';
import { Dump, SourceBase } from './SourceBase';
import { SourceBody } from './SourceBody';
import { SourceField } from './SourceField';
import { SourceMethod } from './SourceMethod';
import { SourceTransformer } from './SourceTransformer';
import { SourceUtils } from './SourceUtils';
import { INSTANCE_INIT_METHOD_NAME, STATIC_INIT_METHOD_NAME } from '../../core/common/Const';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { FieldCategory } from '../../core/model/ArkField';
import { ArkMetadataKind } from '../../core/model/ArkMetadata';

/**
 * @category save
 */
export class SourceClass extends SourceBase {
    protected cls: ArkClass;
    private transformer: SourceTransformer;

    public constructor(cls: ArkClass, indent: string = '') {
        super(cls.getDeclaringArkFile(), indent);
        this.cls = cls;
        this.transformer = new SourceTransformer(this);
    }

    public getDeclaringArkNamespace(): ArkNamespace | undefined {
        return this.cls.getDeclaringArkNamespace();
    }

    public getLine(): number {
        return this.cls.getLine();
    }

    public dump(): string {
        this.printer.clear();
        (this.cls.getMetadata(ArkMetadataKind.LEADING_COMMENTS) as string[] || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });
        if (this.cls.getCategory() === ClassCategory.OBJECT) {
            return this.dumpObject();
        }

        if (this.cls.getCategory() === ClassCategory.TYPE_LITERAL) {
            return this.dumpTypeLiteral();
        }

        this.printDecorator(this.cls.getDecorators());
        // print export class name<> + extends c0 implements x1, x2 {
        this.printer
            .writeIndent()
            .writeSpace(this.modifiersToString(this.cls.getModifiers()))
            .write(`${SourceUtils.classOriginTypeToString.get(this.cls.getCategory())} `);

        if (!SourceUtils.isAnonymousClass(this.cls.getName())) {
            this.printer.write(this.cls.getName());
        }
        const genericsTypes = this.cls.getGenericsTypes();
        if (genericsTypes) {
            this.printer.write(`<${this.transformer.typeArrayToString(genericsTypes)}>`);
        }
        if (this.cls.getSuperClassName() && !this.cls.hasComponentDecorator()) {
            this.printer.write(` extends ${this.cls.getSuperClassName()}`);
        }
        if (this.cls.getImplementedInterfaceNames().length > 0) {
            this.printer.write(` implements ${this.cls.getImplementedInterfaceNames().join(', ')}`);
        }

        this.printer.writeLine(' {');
        this.printer.incIndent();
        let items: Dump[] = [];

        items.push(...this.printFields());
        items.push(...this.printMethods());

        items.sort((a, b) => a.getLine() - b.getLine());
        items.forEach((v): void => {
            this.printer.write(v.dump());
        });

        this.printer.decIndent();
        this.printer.writeIndent().write('}');
        if (!SourceUtils.isAnonymousClass(this.cls.getName())) {
            this.printer.writeLine('');
        }
        return this.printer.toString();
    }

    public dumpOriginal(): string {
        return this.cls.getCode() + '\n';
    }

    private dumpObject(): string {
        this.printer.write('{');

        this.cls.getFields().forEach((field, index, array) => {
            let name = SourceUtils.escape(field.getName());
            if (SourceUtils.isIdentifierText(field.getName())) {
                this.printer.write(name);
            } else {
                this.printer.write(`'${name}'`);
            }

            let instanceInitializer = this.parseFieldInitMethod(INSTANCE_INIT_METHOD_NAME);
            if (instanceInitializer.has(field.getName())) {
                this.printer.write(`: ${instanceInitializer.get(field.getName())}`);
            }

            if (index !== array.length - 1) {
                this.printer.write(`, `);
            }
        });
        this.printer.write('}');
        return this.printer.toString();
    }

    private dumpTypeLiteral(): string {
        this.printer.write('{');

        this.cls.getFields().forEach((field, index, array) => {
            let name = SourceUtils.escape(field.getName());
            if (SourceUtils.isIdentifierText(field.getName())) {
                this.printer.write(`${name}: ${this.transformer.typeToString(field.getType())}`);
            } else {
                this.printer.write(`'${name}': ${this.transformer.typeToString(field.getType())}`);
            }

            if (index !== array.length - 1) {
                this.printer.write(`, `);
            }
        });
        this.printer.write('}');
        return this.printer.toString();
    }

    protected printMethods(): Dump[] {
        let items: Dump[] = [];
        for (let method of this.cls.getMethods()) {
            if (method.isGenerated() || (SourceUtils.isConstructorMethod(method.getName()) && this.cls.hasViewTree())) {
                continue;
            }

            if (method.isDefaultArkMethod()) {
                items.push(...new SourceMethod(method, this.printer.getIndent()).dumpDefaultMethod());
            } else if (!SourceUtils.isAnonymousMethod(method.getName())) {
                items.push(new SourceMethod(method, this.printer.getIndent()));
            }
        }
        return items;
    }

    private printFields(): Dump[] {
        let instanceInitializer = this.parseFieldInitMethod(INSTANCE_INIT_METHOD_NAME);
        let staticInitializer = this.parseFieldInitMethod(STATIC_INIT_METHOD_NAME);
        let items: Dump[] = [];
        for (let field of this.cls.getFields()) {
            if (field.getCategory() === FieldCategory.GET_ACCESSOR) {
                continue;
            }
            if (field.isStatic()) {
                items.push(new SourceField(field, this.printer.getIndent(), staticInitializer));
            } else {
                items.push(new SourceField(field, this.printer.getIndent(), instanceInitializer));
            }
        }
        return items;
    }

    private parseFieldInitMethod(name: string): Map<string, string> {
        let method = this.cls.getMethodWithName(name);
        if (!method || method?.getBody() === undefined) {
            return new Map<string, string>();
        }

        let srcBody = new SourceBody(this.printer.getIndent(), method, false);
        srcBody.dump();
        return srcBody.getTempCodeMap();
    }
}

export class SourceDefaultClass extends SourceClass {
    public constructor(cls: ArkClass, indent: string = '') {
        super(cls, indent);
    }

    public getLine(): number {
        return this.cls.getLine();
    }

    public dump(): string {
        this.printMethods();
        return this.printer.toString();
    }

    public dumpOriginal(): string {
        for (let method of this.cls.getMethods()) {
            if (method.isDefaultArkMethod()) {
                const stmts = method.getOriginalCfg()?.getStmts();
                if (!stmts) {
                    continue;
                }
                for (let stmt of stmts) {
                    let code = stmt.toString();
                    if (!code.startsWith('import') && code !== 'return;') {
                        this.printer.writeLine(code);
                    }
                }
            } else if (method.getCode()) {
                this.printer.writeLine(method.getCode()!);
            }
        }
        return this.printer.toString();
    }
}
