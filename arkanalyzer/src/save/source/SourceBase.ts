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

import { Decorator } from '../../core/base/Decorator';
import { Printer } from '../Printer';
import { ArkFile } from '../../core/model/ArkFile';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ClassSignature, MethodSignature } from '../../core/model/ArkSignature';
import { ArkClass } from '../../core/model/ArkClass';
import { ArkCodeBuffer } from '../ArkStream';
import { Local } from '../../core/base/Local';
import { TransformerContext } from './SourceTransformer';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { modifiers2stringArray } from '../../core/model/ArkBaseModel';

export interface Dump {
    getLine(): number;
    dump(): string;
}

export abstract class SourceBase
    extends Printer
    implements Dump, TransformerContext
{
    protected arkFile: ArkFile;
    protected inBuilder: boolean = false;

    public constructor(arkFile: ArkFile, indent: string = '') {
        super(indent);
        this.arkFile = arkFile;
    }

    public getDeclaringArkNamespace(): ArkNamespace | undefined {
        return undefined
    }

    public getArkFile(): ArkFile {
        return this.arkFile;
    }

    public getMethod(signature: MethodSignature): ArkMethod | null {
        return this.getArkFile().getScene().getMethod(signature);
    }

    public getClass(signature: ClassSignature): ArkClass | null {
        return this.getArkFile().getScene().getClass(signature);
    }

    public getPrinter(): ArkCodeBuffer {
        return this.printer;
    }

    public transTemp2Code(temp: Local): string {
        return temp.getName();
    }

    public isInBuilderMethod(): boolean {
        return this.inBuilder;
    }

    public abstract getLine(): number;

    protected printDecorator(docorator: Decorator[]): void {
        docorator.forEach((value) => {
            this.printer.writeIndent().writeLine(`@${value.getContent()}`);
        });
    }

    protected modifiersToString(modifiers: number): string {
        let modifiersStr: string[] = modifiers2stringArray(modifiers);
        return modifiersStr.join(' ');
    }

    protected resolveKeywordType(keywordStr: string): string {
        // 'NumberKeyword | NullKeyword |
        let types: string[] = [];
        for (let keyword of keywordStr.split('|')) {
            keyword = keyword.trim();
            if (keyword.length === 0) {
                continue;
            }
            if (keyword.endsWith('Keyword')) {
                keyword = keyword
                    .substring(0, keyword.length - 'Keyword'.length)
                    .toLowerCase();
            }
            types.push(keyword);
        }

        return types.join(' | ');
    }

    protected resolveMethodName(name: string): string {
        if (name === '_Constructor') {
            return 'constructor';
        }
        if (name.startsWith('Get-')) {
            return name.replace('Get-', 'get ');
        }
        if (name.startsWith('Set-')) {
            return name.replace('Set-', 'set ');
        }
        return name;
    }
}
