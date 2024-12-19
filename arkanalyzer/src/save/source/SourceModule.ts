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

import { ModifierType } from '../../core/model/ArkBaseModel';
import { ExportInfo, ExportType } from '../../core/model/ArkExport';
import { ImportInfo } from '../../core/model/ArkImport';
import { ArkMetadataKind } from '../../core/model/ArkMetadata';
import { SourceBase } from './SourceBase';

export class SourceExportInfo extends SourceBase {
    info: ExportInfo;

    public constructor(info: ExportInfo, indent: string = '') {
        super(info.getDeclaringArkFile(), indent);
        this.info = info;
    }

    public getLine(): number {
        return this.info.getOriginTsPosition().getLineNo();
    }

    public dump(): string {
        this.printer.clear();
        (this.info.getMetadata(ArkMetadataKind.LEADING_COMMENTS) as string[] || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });

        if (
            !this.info.getFrom() &&
            (this.info.getArkExport()?.containsModifier(ModifierType.EXPORT) ||
                this.info.getExportClauseType() === ExportType.LOCAL ||
                this.info.getExportClauseType() === ExportType.TYPE)
        ) {
            return this.printer.toString();
        }

        if (this.info.getExportClauseName() === '*') {
            // just like: export * as xx from './yy'
            if (this.info.getNameBeforeAs() && this.info.getNameBeforeAs() !== '*') {
                this.printer
                    .writeIndent()
                    .write(`export ${this.info.getNameBeforeAs()} as ${this.info.getExportClauseName()}`);
            } else {
                this.printer.writeIndent().write(`export ${this.info.getExportClauseName()}`);
            }
        } else {
            // just like: export {xxx as x} from './yy'
            if (this.info.getNameBeforeAs()) {
                this.printer.write(`export {${this.info.getNameBeforeAs()} as ${this.info.getExportClauseName()}}`);
            } else {
                this.printer.write(`export {${this.info.getExportClauseName()}}`);
            }
        }
        if (this.info.getFrom()) {
            this.printer.write(` from '${this.info.getFrom() as string}'`);
        }
        this.printer.writeLine(';');

        return this.printer.toString();
    }
    public dumpOriginal(): string {
        return this.info.getTsSourceCode();
    }
}

export class SourceImportInfo extends SourceBase {
    info: ImportInfo;

    public constructor(info: ImportInfo, indent: string = '') {
        super(info.getDeclaringArkFile(), indent);
        this.info = info;
    }

    public getLine(): number {
        return this.info.getOriginTsPosition().getLineNo();
    }

    public dump(): string {
        (this.info.getMetadata(ArkMetadataKind.LEADING_COMMENTS) as string[] || []).forEach((comment) => {
            this.printer.writeIndent().writeLine(comment);
        });
        if (this.info.getImportType() === 'Identifier') {
            // sample: import fs from 'fs'
            this.printer
                .writeIndent()
                .writeLine(`import ${this.info.getImportClauseName()} from '${this.info.getFrom() as string}';`);
        } else if (this.info.getImportType() === 'NamedImports') {
            // sample: import {xxx} from './yyy'
            if (this.info.getNameBeforeAs()) {
                this.printer
                    .writeIndent()
                    .writeLine(
                        `import {${this.info.getNameBeforeAs()} as ${this.info.getImportClauseName()}} from '${
                            this.info.getFrom() as string
                        }';`
                    );
            } else {
                this.printer
                    .writeIndent()
                    .writeLine(`import {${this.info.getImportClauseName()}} from '${this.info.getFrom() as string}';`);
            }
        } else if (this.info.getImportType() === 'NamespaceImport') {
            // sample: import * as ts from 'ohos-typescript'
            this.printer
                .writeIndent()
                .writeLine(`import * as ${this.info.getImportClauseName()} from '${this.info.getFrom() as string}';`);
        } else if (this.info.getImportType() === 'EqualsImport') {
            // sample: import mmmm = require('./xxx')
            this.printer
                .writeIndent()
                .writeLine(`import ${this.info.getImportClauseName()} =  require('${this.info.getFrom() as string}');`);
        } else {
            // sample: import '../xxx'
            this.printer.writeIndent().writeLine(`import '${this.info.getFrom() as string}';`);
        }
        return this.printer.toString();
    }
    public dumpOriginal(): string {
        return this.info.getTsSourceCode();
    }
}
