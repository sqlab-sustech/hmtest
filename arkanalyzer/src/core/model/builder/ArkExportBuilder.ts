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

import ts from 'ohos-typescript';
import { LineColPosition } from '../../base/Position';
import { ArkExport, ExportInfo, ExportType, FromInfo } from '../ArkExport';
import { buildModifiers } from './builderUtils';
import { ArkFile } from '../ArkFile';
import { ALL, DEFAULT } from "../../common/TSConst";
import { ModifierType } from '../ArkBaseModel';
import { IRUtils } from '../../common/IRUtils';

export { buildExportInfo, buildExportAssignment, buildExportDeclaration };

function buildExportInfo(arkInstance: ArkExport, arkFile: ArkFile, line: LineColPosition): ExportInfo {
    return new ExportInfo.Builder()
        .exportClauseName(arkInstance.getName())
        .exportClauseType(arkInstance.getExportType())
        .modifiers(arkInstance.getModifiers())
        .arkExport(arkInstance)
        .originTsPosition(line)
        .declaringArkFile(arkFile)
        .build();
}


export function buildDefaultExportInfo(im: FromInfo, file: ArkFile, arkExport?: ArkExport) {
    return new ExportInfo.Builder()
        .exportClauseType(arkExport?.getExportType() ?? ExportType.CLASS)
        .exportClauseName(im.getOriginName())
        .declaringArkFile(file)
        .arkExport(arkExport ?? file.getDefaultClass())
        .build();
}

function buildExportDeclaration(node: ts.ExportDeclaration, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[] {
    const originTsPosition = LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    const modifiers = node.modifiers ? buildModifiers(node) : 0;
    let exportFrom = '';
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        exportFrom = node.moduleSpecifier.text;
    }
    let exportInfos: ExportInfo[] = [];
    // just like: export {xxx as x} from './yy'
    if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements) {
        node.exportClause.elements.forEach((element) => {
            let builder = new ExportInfo.Builder()
                .exportClauseType(ExportType.UNKNOWN)
                .exportClauseName(element.name.text)
                .tsSourceCode(tsSourceCode)
                .exportFrom(exportFrom)
                .originTsPosition(originTsPosition)
                .declaringArkFile(arkFile)
                .setLeadingComments(IRUtils.getLeadingComments(node, sourceFile, arkFile.getScene().getOptions()))
                .modifiers(modifiers);
            if (element.propertyName && ts.isIdentifier(element.propertyName)) {
                builder.nameBeforeAs(element.propertyName.text);
            }
            exportInfos.push(builder.build());
        });
        return exportInfos;
    }

    let builder1 = new ExportInfo.Builder()
        .exportClauseType(ExportType.UNKNOWN)
        .nameBeforeAs(ALL)
        .modifiers(modifiers)
        .tsSourceCode(tsSourceCode)
        .exportFrom(exportFrom)
        .declaringArkFile(arkFile)
        .setLeadingComments(IRUtils.getLeadingComments(node, sourceFile, arkFile.getScene().getOptions()))
        .originTsPosition(originTsPosition);
    if (node.exportClause && ts.isNamespaceExport(node.exportClause) && ts.isIdentifier(node.exportClause.name)) { // just like: export * as xx from './yy'
        exportInfos.push(builder1.exportClauseName(node.exportClause.name.text).build());
    } else if (!node.exportClause && node.moduleSpecifier) { // just like: export * from './yy'
        exportInfos.push(builder1.exportClauseName(ALL).build());
    }
    return exportInfos;
}

function buildExportAssignment(node: ts.ExportAssignment, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[] {
    let exportInfos: ExportInfo[] = [];
    if (!node.expression) {
        return exportInfos;
    }
    const originTsPosition = LineColPosition.buildFromNode(node, sourceFile);
    const tsSourceCode = node.getText(sourceFile);
    let modifiers = buildModifiers(node);
    if (isKeyword(node.getChildren(sourceFile), ts.SyntaxKind.DefaultKeyword)) {
        modifiers |= ModifierType.DEFAULT;
    }
    if (ts.isObjectLiteralExpression(node.expression) && node.expression.properties) { // just like: export default {a,b,c}
        node.expression.properties.forEach((property) => {
            if (property.name && ts.isIdentifier(property.name)) {
                const exportInfo = new ExportInfo.Builder()
                    .exportClauseName(property.name.text)
                    .exportClauseType(ExportType.UNKNOWN)
                    .nameBeforeAs(property.name.text)
                    .modifiers(modifiers)
                    .tsSourceCode(tsSourceCode)
                    .originTsPosition(originTsPosition)
                    .declaringArkFile(arkFile)
                    .setLeadingComments(IRUtils.getLeadingComments(node, sourceFile, arkFile.getScene().getOptions()))
                    .build();
                exportInfos.push(exportInfo);
            }
        });
    } else {
        const exportInfo = new ExportInfo.Builder()
            .exportClauseType(ExportType.UNKNOWN)
            .modifiers(modifiers)
            .tsSourceCode(tsSourceCode)
            .originTsPosition(originTsPosition)
            .declaringArkFile(arkFile)
            .exportClauseName(DEFAULT)
            .setLeadingComments(IRUtils.getLeadingComments(node, sourceFile, arkFile.getScene().getOptions()))
        if (ts.isIdentifier(node.expression)) { // just like: export default xx
            exportInfo.nameBeforeAs(node.expression.text);
        } else if (ts.isAsExpression(node.expression)) { // just like: export default xx as YY
            exportInfo.nameBeforeAs(node.expression.expression.getText(sourceFile))
        }
        exportInfos.push(exportInfo.build());
    }
    return exportInfos;
}

/**
 * export const c = '', b = 1;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
export function buildExportVariableStatement(node: ts.VariableStatement, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[] {
    let exportInfos: ExportInfo[] = [];
    const originTsPosition = LineColPosition.buildFromNode(node, sourceFile);
    const modifiers = node.modifiers ? buildModifiers(node) : 0;
    const tsSourceCode = node.getText(sourceFile);
    node.declarationList.declarations.forEach(dec => {
        const exportInfo = new ExportInfo.Builder()
            .exportClauseName(dec.name.getText(sourceFile))
            .exportClauseType(ExportType.LOCAL)
            .modifiers(modifiers)
            .tsSourceCode(tsSourceCode)
            .originTsPosition(originTsPosition)
            .declaringArkFile(arkFile)
            .build();
        exportInfos.push(exportInfo);
    })
    return exportInfos;
}

/**
 * export type MyType = string;
 * @param node
 * @param sourceFile
 * @param arkFile
 */
export function buildExportTypeAliasDeclaration(node: ts.TypeAliasDeclaration, sourceFile: ts.SourceFile, arkFile: ArkFile): ExportInfo[] {
    let exportInfos: ExportInfo[] = [];
    const originTsPosition = LineColPosition.buildFromNode(node, sourceFile);
    const modifiers = node.modifiers ? buildModifiers(node) : 0;
    const tsSourceCode = node.getText(sourceFile);
    const exportInfo = new ExportInfo.Builder()
        .exportClauseName(node.name.text)
        .exportClauseType(ExportType.TYPE)
        .tsSourceCode(tsSourceCode)
        .modifiers(modifiers)
        .originTsPosition(originTsPosition)
        .declaringArkFile(arkFile)
        .build();
    exportInfos.push(exportInfo);
    return exportInfos;
}

export function isExported(modifierArray: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
    if (!modifierArray) {
        return false;
    }
    for (let child of modifierArray) {
        if (child.kind === ts.SyntaxKind.ExportKeyword) {
            return true;
        }
    }
    return false;
}

function isKeyword(modifierArray: ts.Node[] | undefined, keyword: ts.SyntaxKind): boolean {
    if (!modifierArray) {
        return false;
    }
    for (let child of modifierArray) {
        if (child.kind === keyword) {
            return true;
        }
    }
    return false;
}
