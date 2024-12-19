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

import { Local } from '../base/Local';
import { ArkClass } from '../model/ArkClass';
import { ArkFile } from '../model/ArkFile';
import { ArkMethod } from '../model/ArkMethod';
import { ArkNamespace } from '../model/ArkNamespace';
import { ClassSignature, FileSignature, MethodSignature } from '../model/ArkSignature';
import { ArkExport, ExportInfo, ExportType, FromInfo } from '../model/ArkExport';
import { ArkField } from '../model/ArkField';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { FileUtils, ModulePath } from '../../utils/FileUtils';
import path from 'path';
import { Sdk } from '../../Config';
import { ALL, DEFAULT, THIS_NAME } from './TSConst';
import { buildDefaultExportInfo } from '../model/builder/ArkExportBuilder';
import { API_INTERNAL, COMPONENT_ATTRIBUTE, COMPONENT_INSTANCE, COMPONENT_PATH } from './EtsConst';
import { ClassType, UnclearReferenceType } from '../base/Type';
import { Scene } from '../../Scene';
import { checkAndUpdateMethod } from '../model/builder/ArkMethodBuilder';
import { DEFAULT_ARK_CLASS_NAME, TEMP_LOCAL_PREFIX } from './Const';

export class ModelUtils {
    public static implicitArkUIBuilderMethods: Set<ArkMethod> = new Set();

    public static getMethodSignatureFromArkClass(arkClass: ArkClass, methodName: string): MethodSignature | null {
        for (const arkMethod of arkClass.getMethods()) {
            if (arkMethod.getName() === methodName) {
                return arkMethod.getSignature();
            }
        }
        return null;
    }

    public static getClassWithNameInNamespaceRecursively(className: string, ns: ArkNamespace): ArkClass | null {
        if (className === '') {
            return null;
        }
        let res: ArkClass | null = null;
        res = ns.getClassWithName(className);
        if (res == null) {
            let declaringNs = ns.getDeclaringArkNamespace();
            if (declaringNs != null) {
                res = this.getClassWithNameInNamespaceRecursively(className, declaringNs);
            } else {
                res = this.getClassInFileWithName(className, ns.getDeclaringArkFile());
            }
        }
        return res;
    }

    public static getClassWithNameFromClass(className: string, startFrom: ArkClass): ArkClass | null {
        if (!className.includes('.')) {
            let res: ArkClass | null = null;
            const arkNamespace = startFrom.getDeclaringArkNamespace();
            if (arkNamespace) {
                res = this.getClassWithNameInNamespaceRecursively(className, arkNamespace);
            } else {
                res = this.getClassInFileWithName(className, startFrom.getDeclaringArkFile());
            }
            return res;
        } else {
            const names = className.split('.');
            let nameSpace = this.getNamespaceWithNameFromClass(names[0], startFrom);
            for (let i = 1; i < names.length - 1; i++) {
                if (nameSpace)
                    nameSpace = nameSpace.getNamespaceWithName(names[i]);
            }
            if (nameSpace) {
                return nameSpace.getClassWithName(names[names.length - 1]);
            }
        }
        return null;
    }

    /**
     *  search class within the file that contain the given method
     */
    public static getClassWithName(className: string, thisClass: ArkClass): ArkClass | null {
        if (thisClass.getName() === className) {
            return thisClass;
        }
        let classSearched = thisClass.getDeclaringArkNamespace()?.getClassWithName(className);
        if (!classSearched) {
            classSearched = thisClass.getDeclaringArkFile().getClassWithName(className);
        }
        return classSearched;
    }

    /** search class within the given file */
    public static getClassInFileWithName(className: string, arkFile: ArkFile): ArkClass | null {
        let classSearched = arkFile.getClassWithName(className);
        if (classSearched != null) {
            return classSearched;
        }
        return null;
    }

    public static getClassInImportInfoWithName(className: string, arkFile: ArkFile): ArkClass | null {
        let arkExport = this.getArkExportInImportInfoWithName(className, arkFile);
        if (arkExport instanceof ArkClass) {
            return arkExport;
        }
        return null;
    }

    /** search type within the given file import infos */
    public static getArkExportInImportInfoWithName(name: string, arkFile: ArkFile): ArkExport | null {
        return arkFile.getImportInfoBy(name)?.getLazyExportInfo()?.getArkExport() ?? null;
    }

    /** search method within the file that contain the given method */
    public static getMethodWithName(methodName: string, startFrom: ArkMethod): ArkMethod | null {
        if (!methodName.includes('.')) {
            if (startFrom.getName() === methodName) {
                return startFrom;
            }

            const thisClass = startFrom.getDeclaringArkClass();
            let methodSearched: ArkMethod | null = thisClass.getMethodWithName(methodName);
            if (!methodSearched) {
                methodSearched = thisClass.getStaticMethodWithName(methodName);
            }
            return methodSearched;
        } else {
            const names = methodName.split('.');
            let nameSpace = this.getNamespaceWithName(names[0], startFrom.getDeclaringArkClass());
            for (let i = 1; i < names.length - 1; i++) {
                if (nameSpace) {
                    nameSpace = nameSpace.getNamespaceWithName(names[i]);
                }
            }
            if (nameSpace) {
                return nameSpace.getDefaultClass().getMethodWithName(names[names.length - 1]);
            }
        }
        return null;
    }

    public static getNamespaceWithNameFromClass(namespaceName: string, startFrom: ArkClass): ArkNamespace | null {
        const thisNamespace = startFrom.getDeclaringArkNamespace();
        let namespaceSearched: ArkNamespace | null = null;
        if (thisNamespace) {
            namespaceSearched = thisNamespace.getNamespaceWithName(namespaceName);
            if (namespaceSearched) {
                return namespaceSearched;
            }
        }
        const thisFile = startFrom.getDeclaringArkFile();
        namespaceSearched = this.getNamespaceInFileWithName(namespaceName, thisFile);
        return namespaceSearched;
    }

    public static getNamespaceWithName(namespaceName: string, thisClass: ArkClass): ArkNamespace | null {
        const thisNamespace = thisClass.getDeclaringArkNamespace();
        let namespaceSearched: ArkNamespace | null = null;
        if (thisNamespace) {
            namespaceSearched = thisNamespace.getNamespaceWithName(namespaceName);
        }
        if (!namespaceSearched) {
            namespaceSearched = thisClass.getDeclaringArkFile().getNamespaceWithName(namespaceName);
        }
        return namespaceSearched;
    }

    public static getNamespaceInFileWithName(namespaceName: string, arkFile: ArkFile): ArkNamespace | null {
        let namespaceSearched = arkFile.getNamespaceWithName(namespaceName);
        if (namespaceSearched) {
            return namespaceSearched;
        }

        return null;
    }

    public static getNamespaceInImportInfoWithName(namespaceName: string, arkFile: ArkFile): ArkNamespace | null {
        let arkExport = this.getArkExportInImportInfoWithName(namespaceName, arkFile);
        if (arkExport instanceof ArkNamespace) {
            return arkExport;
        }
        return null;
    }

    public static getStaticMethodWithName(methodName: string, thisClass: ArkClass): ArkMethod | null {

        const thisNamespace = thisClass.getDeclaringArkNamespace();
        if (thisNamespace) {
            const defaultClass = thisNamespace.getClassWithName(DEFAULT_ARK_CLASS_NAME);
            if (defaultClass) {
                const method = defaultClass.getMethodWithName(methodName);
                if (method) {
                    return method;
                }
            }
        }
        return this.getStaticMethodInFileWithName(methodName, thisClass.getDeclaringArkFile());
    }

    public static getStaticMethodInFileWithName(methodName: string, arkFile: ArkFile): ArkMethod | null {
        const defaultClass = arkFile.getClasses().find(cls => cls.getName() === DEFAULT_ARK_CLASS_NAME) || null;
        if (defaultClass) {
            let method = defaultClass.getMethodWithName(methodName);
            if (method) {
                return method;
            }
        }
        return null;
    }

    public static getStaticMethodInImportInfoWithName(methodName: string, arkFile: ArkFile): ArkMethod | null {
        let arkExport = this.getArkExportInImportInfoWithName(methodName, arkFile);
        if (arkExport instanceof ArkMethod) {
            return arkExport;
        }
        return null;
    }

    public static getLocalInImportInfoWithName(localName: string, arkFile: ArkFile): Local | null {
        let arkExport = this.getArkExportInImportInfoWithName(localName, arkFile);
        if (arkExport instanceof Local) {
            return arkExport;
        }
        return null;
    }

    /* get nested namespaces in a file */
    public static getAllNamespacesInFile(arkFile: ArkFile): ArkNamespace[] {
        const arkNamespaces: ArkNamespace[] = arkFile.getNamespaces();
        for (const arkNamespace of arkFile.getNamespaces()) {
            this.getAllNamespacesInNamespace(arkNamespace, arkNamespaces);
        }
        return arkNamespaces;
    }

    /* get nested namespaces in a namespace */
    public static getAllNamespacesInNamespace(arkNamespace: ArkNamespace, allNamespaces: ArkNamespace[]): void {
        allNamespaces.push(...arkNamespace.getNamespaces());
        for (const nestedNamespace of arkNamespace.getNamespaces()) {
            this.getAllNamespacesInNamespace(nestedNamespace, allNamespaces);
        }
    }

    public static getAllClassesInFile(arkFile: ArkFile): ArkClass[] {
        const allClasses = arkFile.getClasses();
        this.getAllNamespacesInFile(arkFile).forEach((namespace) => {
            allClasses.push(...namespace.getClasses());
        });
        return allClasses;
    }

    public static getAllMethodsInFile(arkFile: ArkFile): ArkMethod[] {
        const allMethods: ArkMethod[] = [];
        this.getAllClassesInFile(arkFile).forEach((cls) => {
            allMethods.push(...cls.getMethods());
        });
        return allMethods;
    }

    public static isArkUIBuilderMethod(arkMethod: ArkMethod): boolean {
        let isArkUIBuilderMethod = arkMethod.hasBuilderDecorator() || this.implicitArkUIBuilderMethods.has(arkMethod);

        if (
            !isArkUIBuilderMethod &&
            arkMethod.getName() === 'build' &&
            arkMethod.getDeclaringArkClass().hasComponentDecorator() &&
            !arkMethod.isStatic()
        ) {
            const fileName = arkMethod.getDeclaringArkClass().getDeclaringArkFile().getName();
            if (fileName.endsWith('.ets')) {
                isArkUIBuilderMethod = true;
            }
        }
        return isArkUIBuilderMethod;
    }

    public static getArkClassInBuild(scene: Scene, classType: ClassType): ArkClass | null {
        const classSignature = classType.getClassSignature();
        const file = scene.getFile(classSignature.getDeclaringFileSignature());
        const namespaceSignature = classSignature.getDeclaringNamespaceSignature();
        if (namespaceSignature) {
            return file?.getNamespace(namespaceSignature)?.getClass(classSignature) || null;
        }
        return file?.getClassWithName(classSignature.getClassName()) || null;
    }

    public static getDefaultClass(arkClass: ArkClass): ArkClass | null {
        return arkClass.getDeclaringArkNamespace()?.getDefaultClass() ?? arkClass.getDeclaringArkFile().getDefaultClass();
    }

    public static getClass(method: ArkMethod, signature: ClassSignature): ArkClass | null {
        let cls: ArkClass | undefined | null = method.getDeclaringArkFile().getScene().getClass(signature);
        if (cls) {
            return cls;
        }
        let importInfo = method.getDeclaringArkFile().getImportInfoBy(signature.getClassName());
        let exportInfo = importInfo ? findExportInfo(importInfo) : null;
        let arkExport = exportInfo?.getArkExport();
        if (arkExport instanceof ArkClass) {
            return arkExport;
        }

        cls = method.getDeclaringArkClass().getDeclaringArkNamespace()?.getClassWithName(signature.getClassName());
        if (cls) {
            return cls;
        }

        for (const ns of method.getDeclaringArkFile().getAllNamespacesUnderThisFile()) {
            cls = ns.getClassWithName(signature.getClassName());
            if (cls) {
                return cls;
            }
        }

        return method.getDeclaringArkFile().getClassWithName(signature.getClassName());
    }

    public static findPropertyInNamespace(name: string, namespace: ArkNamespace): ArkExport | undefined {
        return namespace.getDefaultClass()?.getMethodWithName(name)
            ?? findArkExport(namespace.getExportInfoBy(name))
            ?? namespace.getClassWithName(name)
            ?? namespace.getNamespaceWithName(name)
            ?? namespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name)
            ?? namespace.getDefaultClass()?.getDefaultArkMethod()?.getBody()?.getLocals()?.get(name);
    }

    public static findPropertyInClass(name: string, arkClass: ArkClass): ArkExport | ArkField | null {
        let property;
        let currentClass: ArkClass | null = arkClass;
        do {
            property = currentClass.getMethodWithName(name) ?? currentClass.getStaticMethodWithName(name)
                ?? currentClass.getFieldWithName(name) ?? currentClass.getStaticFieldWithName(name);
            currentClass = currentClass.getSuperClass();
        } while (!property && currentClass);
        if (property) {
            return property;
        }
        if (arkClass.isDefaultArkClass()) {
            return findArkExport(arkClass.getDeclaringArkFile().getExportInfoBy(name));
        }
        return null;
    }

    public static buildGlobalMap(file: ArkFile, globalMap: Map<string, ArkExport>): void {
        if (file.getFilePath().includes(COMPONENT_PATH) || file.getFilePath().includes(API_INTERNAL)) {
            this.getAllClassesInFile(file).forEach(cls => {
                if (!cls.isAnonymousClass() && !cls.isDefaultArkClass()) {
                    globalMap.set(cls.getName(), cls);
                }
                if (cls.isDefaultArkClass()) {
                    cls.getMethods().forEach(mtd => {
                        if (!mtd.isDefaultArkMethod() && !mtd.isAnonymousMethod()) {
                            globalMap.set(mtd.getName(), mtd);
                        }
                    });
                }
            });
            file.getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals().forEach(local => {
                const name = local.getName();
                if (name !== THIS_NAME && !name.startsWith(TEMP_LOCAL_PREFIX) && !name.endsWith(COMPONENT_INSTANCE)) {
                    const type = local.getType();
                    let arkExport;
                    if (type instanceof UnclearReferenceType) {
                        arkExport = findArkExportInFile(type.getName(), file);
                    } else if (type instanceof ClassType) {
                        arkExport = file.getScene().getClass(type.getClassSignature());
                    }
                    if (arkExport instanceof ArkClass) {
                        const signature = new ClassSignature(name, arkExport.getSignature().getDeclaringFileSignature(),
                            arkExport.getSignature().getDeclaringNamespaceSignature());
                        let entry = new ArkClass();
                        entry.setSignature(signature);
                        arkExport.getMethods().forEach(m => {
                            const ms = m.getSignature();
                            m.setDeclareSignatures(new MethodSignature(signature, ms.getMethodSubSignature()));
                            checkAndUpdateMethod(m, entry);
                            entry.addMethod(m);
                        });
                        const attr = globalMap.get(name + COMPONENT_ATTRIBUTE);
                        if (attr instanceof ArkClass) {
                            attr.getMethods().forEach(m => {
                                const ms = m.getSignature();
                                m.setDeclareSignatures(new MethodSignature(signature, ms.getMethodSubSignature()));
                                checkAndUpdateMethod(m, entry);
                                entry.addMethod(m);
                            });
                        }
                        globalMap.set(name, entry);
                    }
                }
            });
        }
    }
}


const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'ModelUtils');
let moduleMap: Map<string, ModulePath> | undefined;
const fileSuffixArray = ['.ets', '.ts', '.d.ets', '.d.ts'];

/**
 * find arkFile by from info
 * export xx from '../xx'
 * import xx from '@ohos/xx'
 * import xx from '@ohos.xx'
 * @param im importInfo or exportInfo
 */
export function getArkFile(im: FromInfo): ArkFile | null | undefined {
    const from = im.getFrom();
    if (!from) {
        return null;
    }
    if (/^([^@]*\/)([^\/]*)$/.test(from)) { //relative path
        const parentPath = /^\.{1,2}\//.test(from) ? path.dirname(im.getDeclaringArkFile().getFilePath())
            : im.getDeclaringArkFile().getProjectDir();
        const originPath = path.resolve(parentPath, from);
        return getArkFileFromScene(im, originPath);
    } else if (/^@[a-z|\-]+?\//.test(from)) { //module path
        const arkFile = getArkFileFromOtherModule(im);
        if (arkFile) {
            return arkFile;
        }
    }
    //sdk path
    const scene = im.getDeclaringArkFile().getScene();
    for (const sdk of scene.getProjectSdkMap().values()) {
        const arkFile = getArkFileFormMap(sdk.name, processSdkPath(sdk, from), scene);
        if (arkFile) {
            return arkFile;
        }
    }
}

/**
 * find from info's export
 * @param fromInfo importInfo or exportInfo
 */
export function findExportInfo(fromInfo: FromInfo): ExportInfo | null {
    let file = getArkFile(fromInfo);
    if (!file) {
        logger.warn(`${fromInfo.getOriginName()} ${fromInfo.getFrom()} file not found: 
        ${fromInfo.getDeclaringArkFile()?.getFileSignature()?.toString()}`);
        return null;
    }
    let exportInfo = findExportInfoInfile(fromInfo, file) || null;
    if (exportInfo === null) {
        logger.warn('export info not found, ' + fromInfo.getFrom() + ' in file: '
            + fromInfo.getDeclaringArkFile().getFileSignature().toString());
        return null;
    }
    const arkExport = findArkExport(exportInfo);
    exportInfo.setArkExport(arkExport);
    if (arkExport) {
        exportInfo.setExportClauseType(arkExport.getExportType());
    }
    return exportInfo;
}

export function findArkExport(exportInfo: ExportInfo | undefined): ArkExport | null {
    if (!exportInfo) {
        return null;
    }
    let arkExport = exportInfo.getArkExport();
    if (arkExport || arkExport === null) {
        return arkExport;
    }
    if (!exportInfo.getFrom()) {
        const name = exportInfo.getOriginName();
        if (exportInfo.getExportClauseType() === ExportType.LOCAL) {
            arkExport = exportInfo.getDeclaringArkFile().getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals().get(name) || null;
        } else if (exportInfo.getExportClauseType() === ExportType.TYPE) {
            arkExport = exportInfo.getDeclaringArkFile().getDefaultClass().getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name) || null;
        } else {
            arkExport = findArkExportInFile(name, exportInfo.getDeclaringArkFile());
        }
    } else if (exportInfo.getExportClauseType() === ExportType.UNKNOWN) {
        const result = findExportInfo(exportInfo);
        if (result) {
            arkExport = result.getArkExport() || null;
        }
    }
    if (!arkExport) {
        logger.warn(`${exportInfo.getExportClauseName()} get arkExport fail from ${exportInfo.getFrom()} at
                ${exportInfo.getDeclaringArkFile().getFileSignature().toString()}`);
    }
    return arkExport || null;
}

export function findArkExportInFile(name: string, declaringArkFile: ArkFile): ArkExport | null {
    let arkExport: ArkExport | undefined | null = declaringArkFile.getClassWithName(name)
        ?? declaringArkFile.getDefaultClass().getMethodWithName(name)
        ?? declaringArkFile.getNamespaceWithName(name)
        ?? declaringArkFile.getDefaultClass().getDefaultArkMethod()?.getBody()?.getLocals().get(name)
        ?? declaringArkFile.getDefaultClass().getDefaultArkMethod()?.getBody()?.getAliasTypeByName(name);
    if (!arkExport) {
        const importInfo = declaringArkFile.getImportInfoBy(name);
        if (importInfo) {
            const result = findExportInfo(importInfo);
            if (result) {
                arkExport = result.getArkExport();
            }
        }
    }
    return arkExport || null;
}

function processSdkPath(sdk: Sdk, formPath: string): string {
    let dir;
    if (formPath.startsWith('@ohos.') || formPath.startsWith('@hms.') || formPath.startsWith('@system.')) {
        dir = 'api';
    } else if (formPath.startsWith('@kit.')) {
        dir = 'kits';
    } else if (formPath.startsWith('@arkts.')) {
        dir = 'arkts';
    } else {
        let originPath = path.join(sdk.path, formPath);
        if (FileUtils.isDirectory(originPath)) {
            formPath = path.join(formPath, FileUtils.getIndexFileName(originPath));
        }
        return `${formPath}`;
    }
    return `${dir}/${formPath}`;
}

function getArkFileFromScene(im: FromInfo, originPath: string) {
    if (FileUtils.isDirectory(originPath)) {
        originPath = path.join(originPath, FileUtils.getIndexFileName(originPath));
    }
    const fileName = path.relative(im.getDeclaringArkFile().getProjectDir(), originPath);
    const scene = im.getDeclaringArkFile().getScene();
    if (/\.e?ts$/.test(originPath)) {
        const fromSignature = new FileSignature(im.getDeclaringArkFile().getProjectName(), fileName);
        return scene.getFile(fromSignature);
    }
    const projectName = im.getDeclaringArkFile().getProjectName();
    return getArkFileFormMap(projectName, fileName, scene);
}

function getArkFileFormMap(projectName: string, filePath: string, scene: Scene): ArkFile | null {
    if (/\.e?ts$/.test(filePath)) {
        return scene.getFile(new FileSignature(projectName, filePath));
    }
    for (const suffix of fileSuffixArray) {
        const arkFile = scene.getFile(new FileSignature(projectName, filePath + suffix));
        if (arkFile) {
            return arkFile;
        }
    }
    return null;
}


function findExportInfoInfile(fromInfo: FromInfo, file: ArkFile) {
    const exportName = fromInfo.isDefault() ? DEFAULT : fromInfo.getOriginName();
    let exportInfo = file.getExportInfoBy(exportName);
    if (exportInfo) {
        return exportInfo;
    }

    if (fromInfo.isDefault()) {
        exportInfo = file.getExportInfos().find(p => p.isDefault());
        if (exportInfo) {
            file.addExportInfo(exportInfo, DEFAULT);
            return exportInfo;
        }
    }

    if (fromInfo.getOriginName() === ALL) {
        exportInfo = buildDefaultExportInfo(fromInfo, file);
        file.addExportInfo(exportInfo, ALL);
    } else if (/\.d\.e?ts$/.test(file.getName())) {
        const declare = findArkExportInFile(fromInfo.getOriginName(), file);
        if (declare) {
            exportInfo = buildDefaultExportInfo(fromInfo, file, declare);
        }
    }

    return exportInfo;
}


function getArkFileFromOtherModule(fromInfo: FromInfo) {
    if (moduleMap === undefined) {
        moduleMap = FileUtils.generateModuleMap(fromInfo.getDeclaringArkFile().getScene().getOhPkgContentMap());
    }
    if (!moduleMap || moduleMap.size === 0) {
        return;
    }
    const from = fromInfo.getFrom()!;
    let index: number;
    let file;
    let modulePath;
    //find file by given from like '@ohos/module/src/xxx' '@ohos/module/index'
    if ((index = from.indexOf('src')) > 0 || (index = from.indexOf('Index')) > 0 || (index = from.indexOf('index')) > 0) {
        modulePath = moduleMap.get(from.substring(0, index).replace(/\/*$/, ''));
        file = findFileInModule(fromInfo, modulePath, from.substring(index));
    }
    if (file) {
        return file;
    }
    modulePath = modulePath ?? moduleMap.get(from);
    if (!modulePath) {
        return file;
    }
    //find file in module json main path
    if (modulePath.main) {
        file = getArkFileFromScene(fromInfo, modulePath.main);
    }
    //find file in module path Index.ts
    if (!file && FileUtils.isDirectory(modulePath.path)) {
        file = findFileInModule(fromInfo, modulePath, FileUtils.getIndexFileName(modulePath.path));
    }
    //find file in module path/src/main/ets/TsIndex.ts
    if (!file) {
        file = findFileInModule(fromInfo, modulePath, '/src/main/ets/TsIndex.ts');
    }
    return file;
}

function findFileInModule(fromInfo: FromInfo, modulePath: ModulePath | undefined, contentPath: string) {
    if (!modulePath) {
        return;
    }
    const originPath = path.join(modulePath.path, contentPath);
    let file;
    if (originPath !== modulePath.main) {
        file = getArkFileFromScene(fromInfo, originPath);
    }
    if (file && findExportInfoInfile(fromInfo, file)) {
        return file;
    }
}