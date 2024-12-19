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

import { ArkMetadataKind } from '../../core/model/ArkMetadata';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import { Dump, SourceBase } from './SourceBase';
import { SourceClass } from './SourceClass';
import { SourceMethod } from './SourceMethod';
import { SourceExportInfo } from './SourceModule';
import { SourceUtils } from './SourceUtils';

/**
 * @category save
 */
export class SourceNamespace extends SourceBase {
    ns: ArkNamespace;

    public constructor(ns: ArkNamespace, indent: string = '') {
        super(ns.getDeclaringArkFile(), indent);
        this.ns = ns;
    }

    public getLine(): number {
        return this.ns.getLine();
    }

    public dump(): string {
        (this.ns.getMetadata(ArkMetadataKind.LEADING_COMMENTS) as string[] || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });
        this.printer
            .writeIndent()
            .writeSpace(this.modifiersToString(this.ns.getModifiers()))
            .writeLine(`namespace ${this.ns.getName()} {`);
        this.printer.incIndent();

        let items: Dump[] = [];

        // print class
        for (let cls of this.ns.getClasses()) {
            if (SourceUtils.isAnonymousClass(cls.getName())) {
                continue;
            }
            if (cls.isDefaultArkClass()) {
                for (let method of cls.getMethods()) {
                    if (method.isDefaultArkMethod()) {
                        items.push(
                            ...new SourceMethod(
                                method,
                                this.printer.getIndent()
                            ).dumpDefaultMethod()
                        );
                    } else if (
                        !SourceUtils.isAnonymousMethod(method.getName())
                    ) {
                        items.push(
                            new SourceMethod(method, this.printer.getIndent())
                        );
                    }
                }
            } else {
                items.push(new SourceClass(cls, this.printer.getIndent()));
            }
        }

        // print namespace
        for (let childNs of this.ns.getNamespaces()) {
            items.push(new SourceNamespace(childNs, this.printer.getIndent()));
        }

        // print exportInfos
        for (let exportInfo of this.ns.getExportInfos()) {
            items.push(
                new SourceExportInfo(exportInfo, this.printer.getIndent())
            );
        }

        items.sort((a, b) => a.getLine() - b.getLine());
        items.forEach((v): void => {
            this.printer.write(v.dump());
        });

        this.printer.decIndent();
        this.printer.writeIndent().writeLine('}');

        return this.printer.toString();
    }

    public dumpOriginal(): string {
        return this.ns.getCode();
    }
}
