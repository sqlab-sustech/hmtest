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

import { ArkField, FieldCategory } from '../../core/model/ArkField';
import { SourceBase } from './SourceBase';
import { SourceTransformer } from './SourceTransformer';
import { UnknownType } from '../../core/base/Type';
import { ArkMetadataKind } from '../../core/model/ArkMetadata';

/**
 * @category save
 */
export class SourceField extends SourceBase {
    private field: ArkField;
    private transformer: SourceTransformer;
    private initializer: Map<string, string>;

    public constructor(field: ArkField, indent: string = '', initializer: Map<string, string>) {
        super(field.getDeclaringArkClass().getDeclaringArkFile(), indent);
        this.field = field;
        this.transformer = new SourceTransformer(this);
        this.initializer = initializer;
    }

    public getLine(): number {
        return this.field.getOriginPosition().getLineNo();
    }
    public dump(): string {
        this.printer.clear();
        (this.field.getMetadata(ArkMetadataKind.LEADING_COMMENTS) as string[] || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });
        this.printDecorator(this.field.getDecorators());
        this.printer.writeIndent();
        if (this.field.getCategory() !== FieldCategory.ENUM_MEMBER) {
            this.printer.writeSpace(this.modifiersToString(this.field.getModifiers()));
        }

        this.printer.write(this.field.getName());

        if (this.field.getQuestionToken()) {
            this.printer.write('?');
        }
        if (this.field.getExclamationToken()) {
            this.printer.write('!');
        }

        // property.getInitializer() PropertyAccessExpression ArrowFunction ClassExpression FirstLiteralToken StringLiteral
        if (!(this.field.getType() instanceof UnknownType) && this.field.getCategory() !== FieldCategory.ENUM_MEMBER) {
            this.printer.write(`: ${this.transformer.typeToString(this.field.getType())}`);
        }

        if (this.initializer.has(this.field.getName())) {
            this.printer.write(` = ${this.initializer.get(this.field.getName())}`);
        }

        if (this.field.getCategory() === FieldCategory.ENUM_MEMBER) {
            this.printer.writeLine(',');
        } else {
            this.printer.writeLine(';');
        }
        return this.printer.toString();
    }
    public dumpOriginal(): string {
        return this.field.getCode() + '\n';
    }
}
