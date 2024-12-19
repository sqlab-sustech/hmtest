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

import { LineColPosition } from '../../base/Position';
import { buildDefaultArkClassFromArkNamespace, buildNormalArkClassFromArkNamespace } from './ArkClassBuilder';
import { ArkFile } from '../ArkFile';
import { buildArkMethodFromArkClass } from './ArkMethodBuilder';
import ts from 'ohos-typescript';
import { ArkNamespace } from '../ArkNamespace';
import { buildDecorators, buildModifiers } from './builderUtils';
import Logger, { LOG_MODULE_TYPE } from '../../../utils/logger';
import { buildExportAssignment, buildExportDeclaration, buildExportInfo } from './ArkExportBuilder';
import { ArkClass } from '../ArkClass';
import { ArkMethod } from '../ArkMethod';
import { NamespaceSignature } from '../ArkSignature';
import { IRUtils } from '../../common/IRUtils';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'ArkNamespaceBuilder');

export function buildArkNamespace(node: ts.ModuleDeclaration, declaringInstance: ArkFile | ArkNamespace, ns: ArkNamespace, sourceFile: ts.SourceFile) {
    // modifiers
    if (node.modifiers) {
        ns.setModifiers(buildModifiers(node));
        ns.setDecorators(buildDecorators(node, sourceFile));
    }

    if (declaringInstance instanceof ArkFile) {
        ns.setDeclaringArkFile(declaringInstance);
    } else {
        ns.setDeclaringArkNamespace(declaringInstance);
        ns.setDeclaringArkFile(declaringInstance.getDeclaringArkFile());
    }
    ns.setDeclaringInstance(declaringInstance);
    const namespaceName = node.name.text;
    const namespaceSignature = new NamespaceSignature(namespaceName, ns.getDeclaringArkFile().getFileSignature(),
        ns.getDeclaringArkNamespace()?.getSignature() || null);
    ns.setSignature(namespaceSignature);

    // TODO: whether needed?
    ns.setCode(node.getText(sourceFile));

    // set line and column
    const { line, character } = ts.getLineAndCharacterOfPosition(
        sourceFile,
        node.getStart(sourceFile)
    );
    ns.setLine(line + 1);
    ns.setColumn(character + 1);

    genDefaultArkClass(ns, node, sourceFile);

    // build ns member
    if (node.body) {
        if (ts.isModuleBlock(node.body)) {
            buildNamespaceMembers(node.body, ns, sourceFile);
        }
        // NamespaceDeclaration extends ModuleDeclaration
        //TODO: Check
        else if (ts.isModuleDeclaration(node.body)) {
            logger.warn("This ModuleBody is an NamespaceDeclaration.");
            let childNs: ArkNamespace = new ArkNamespace();
            buildArkNamespace(node.body, ns, childNs, sourceFile)
        }
        else if (ts.isIdentifier(node.body)) {
            logger.warn("ModuleBody is Identifier.");
        }
        else {
            logger.warn("JSDocNamespaceDeclaration found.");
        }
    }
    else {
        logger.warn("JSDocNamespaceDeclaration found.");
    }
    IRUtils.setLeadingComments(ns, node, sourceFile, ns.getDeclaringArkFile().getScene().getOptions());
}

// TODO: check and update
function buildNamespaceMembers(node: ts.ModuleBlock, namespace: ArkNamespace, sourceFile: ts.SourceFile) {
    const statements = node.statements;
    statements.forEach((child) => {
        if (
            ts.isModuleDeclaration(child)
            //child.kind === ts.SyntaxKind.ModuleDeclaration
        ) {
            let childNs: ArkNamespace = new ArkNamespace();
            childNs.setDeclaringArkNamespace(namespace);
            childNs.setDeclaringArkFile(namespace.getDeclaringArkFile());

            buildArkNamespace(child, namespace, childNs, sourceFile);
            namespace.addNamespace(childNs);

            if (childNs.isExported()) {
                namespace.addExportInfo(buildExportInfo(childNs, namespace.getDeclaringArkFile(),
                    LineColPosition.buildFromNode(child, sourceFile)));
            }
        } else if (
            ts.isClassDeclaration(child) ||
            ts.isInterfaceDeclaration(child) ||
            ts.isEnumDeclaration(child) ||
            ts.isStructDeclaration(child)
        ) {
            let cls: ArkClass = new ArkClass();

            buildNormalArkClassFromArkNamespace(child, namespace, cls, sourceFile);
            namespace.addArkClass(cls);

            if (cls.isExported()) {
                namespace.addExportInfo(buildExportInfo(cls, namespace.getDeclaringArkFile(),
                    LineColPosition.buildFromNode(child, sourceFile)));
            }
        }
        // TODO: Check
        else if (ts.isMethodDeclaration(child)) {
            logger.warn("This is a MethodDeclaration in ArkNamespace.");
            let mthd: ArkMethod = new ArkMethod();

            buildArkMethodFromArkClass(child, namespace.getDefaultClass(), mthd, sourceFile);

            if (mthd.isExported()) {
                namespace.addExportInfo(buildExportInfo(mthd, namespace.getDeclaringArkFile(),
                    LineColPosition.buildFromNode(child, sourceFile)));
            }
        } else if (ts.isFunctionDeclaration(child)) {
            let mthd: ArkMethod = new ArkMethod();

            buildArkMethodFromArkClass(child, namespace.getDefaultClass(), mthd, sourceFile);

            if (mthd.isExported()) {
                namespace.addExportInfo(buildExportInfo(mthd, namespace.getDeclaringArkFile(),
                    LineColPosition.buildFromNode(child, sourceFile)));
            }
        } else if (ts.isExportDeclaration(child)) {
            buildExportDeclaration(child, sourceFile, namespace.getDeclaringArkFile())
                .forEach(item => namespace.addExportInfo(item));
        } else if (ts.isExportAssignment(child)) {
            buildExportAssignment(child, sourceFile, namespace.getDeclaringArkFile())
                .forEach(item => namespace.addExportInfo(item));
        } else {
            logger.info('Child joined default method of arkFile: ', ts.SyntaxKind[child.kind]);
            // join default method
        }
    });
}

function genDefaultArkClass(ns: ArkNamespace, node: ts.ModuleDeclaration, sourceFile: ts.SourceFile) {
    let defaultClass = new ArkClass();

    buildDefaultArkClassFromArkNamespace(ns, defaultClass, node, sourceFile);
    ns.setDefaultClass(defaultClass);
    ns.addArkClass(defaultClass);
}
