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

import { ModuleScene, Scene } from '../../Scene';
import { ExportInfo } from './ArkExport';
import { ImportInfo } from './ArkImport';
import { ArkClass } from './ArkClass';
import { ArkNamespace } from './ArkNamespace';
import { ClassSignature, FileSignature, NamespaceSignature } from './ArkSignature';
import { ALL } from "../common/TSConst";

export const notStmtOrExprKind = ['ModuleDeclaration', 'ClassDeclaration', 'InterfaceDeclaration', 'EnumDeclaration', 'ExportDeclaration',
    'ExportAssignment', 'MethodDeclaration', 'Constructor', 'FunctionDeclaration', 'GetAccessor', 'SetAccessor', 'ArrowFunction',
    'FunctionExpression', 'MethodSignature', 'ConstructSignature', 'CallSignature'];

/**
 * @category core/model
 */
export class ArkFile {
    private absoluteFilePath: string = '';
    private projectDir: string = '';
    private code: string = '';

    private defaultClass!: ArkClass;

    // name to model
    private namespaces: Map<string, ArkNamespace> = new Map<string, ArkNamespace>(); // don't contain nested namespaces
    private classes: Map<string, ArkClass> = new Map<string, ArkClass>(); // don't contain class in namespace

    private importInfoMap: Map<string, ImportInfo> = new Map<string, ImportInfo>();
    private exportInfoMap: Map<string, ExportInfo> = new Map<string, ExportInfo>();

    private scene!: Scene;
    private moduleScene?: ModuleScene;

    private fileSignature: FileSignature = FileSignature.DEFAULT;

    private ohPackageJson5Path: string[] = [];

    private anonymousClassNumber: number = 0;

    constructor() {
    }

    /**
     * Returns the **string** name of the file, which also acts as the file's relative path.
     * @returns The file's name (also means its relative path).
     */
    public getName() {
        return this.fileSignature.getFileName();
    }

    public setScene(scene: Scene) {
        this.scene = scene;
    }

    /**
     * Returns the scene (i.e., {@link Scene}) built for the project. The {@link Scene} is the core class of ArkAnalyzer, 
     * through which users can access all the information of the analyzed code (project), 
     * including file list, class list, method list, property list, etc.
     * @returns The scene of the file.
     */
    public getScene() {
        return this.scene;
    }

    public getModuleScene() {
        return this.moduleScene;
    }

    public setModuleScene(moduleScene: ModuleScene) {
        this.moduleScene = moduleScene;
    }

    public setProjectDir(projectDir: string) {
        this.projectDir = projectDir;
    }

    public getProjectDir(): string {
        return this.projectDir;
    }

    /**
     * Get a file path.
     * @returns The absolute file path.
     * @example
     * 1. Read source code based on file path.

    ```typescript
    let str = fs.readFileSync(arkFile.getFilePath(), 'utf8');
    ```
     */
    public getFilePath(): string {
        return this.absoluteFilePath;
    }

    public setFilePath(absoluteFilePath: string) {
        this.absoluteFilePath = absoluteFilePath;
    }

    public setCode(code: string) {
        this.code = code;
    }

    /**
     * Returns the codes of file as a **string.**
     * @returns the codes of file.
     */
    public getCode() {
        return this.code;
    }

    public addArkClass(arkClass: ArkClass) {
        this.classes.set(arkClass.getName(), arkClass);
    }

    public getDefaultClass() {
        return this.defaultClass;
    }

    public setDefaultClass(defaultClass: ArkClass) {
        this.defaultClass = defaultClass;
    }

    public getNamespace(namespaceSignature: NamespaceSignature): ArkNamespace | null {
        const namespaceName = namespaceSignature.getNamespaceName();
        return this.getNamespaceWithName(namespaceName);
    }

    public getNamespaceWithName(namespaceName: string): ArkNamespace | null {
        return this.namespaces.get(namespaceName) || null;
    }

    public getNamespaces(): ArkNamespace[] {
        return Array.from(this.namespaces.values());
    }

    /**
     * Returns the class based on its class signature. If the class could not be found, **null** will be returned.
     * @param classSignature - the class signature.
     * @returns A class. If there is no class, the return will be a **null**.
     */
    public getClass(classSignature: ClassSignature): ArkClass | null {
        const className = classSignature.getClassName();
        return this.getClassWithName(className);
    }

    public getClassWithName(Class: string): ArkClass | null {
        return this.classes.get(Class) || null;
    }

    public getClasses(): ArkClass[] {
        return Array.from(this.classes.values());
    }

    public addNamespace(namespace: ArkNamespace) {
        this.namespaces.set(namespace.getName(), namespace);
    }
    
    /**
     * Returns an **array** of import information. 
     * The import information includes: clause's name, type, modifiers, location where it is imported from, etc.
     * @returns An **array** of import information.
     */
    public getImportInfos(): ImportInfo[] {
        return Array.from(this.importInfoMap.values());
    }

    public getImportInfoBy(name: string): ImportInfo | undefined {
        return this.importInfoMap.get(name);
    }

    public addImportInfo(importInfo: ImportInfo) {
        this.importInfoMap.set(importInfo.getImportClauseName(), importInfo);
    }

    public removeImportInfo(importInfo: ImportInfo): boolean {
        return this.importInfoMap.delete(importInfo.getImportClauseName());
    }

    public removeNamespace(namespace: ArkNamespace): boolean {
        let rtn = this.namespaces.delete(namespace.getName());
        rtn &&= this.getScene().removeNamespace(namespace);
        return rtn;
    }

    public removeArkClass(arkClass: ArkClass): boolean {
        let rtn = this.classes.delete(arkClass.getName());
        rtn &&= this.getScene().removeClass(arkClass);
        return rtn;
    }

    public getExportInfos(): ExportInfo[] {
        const exportInfos: ExportInfo[] = [];
        this.exportInfoMap.forEach((value, key) => {
            if (key !== ALL || value.getFrom()) {
                exportInfos.push(value);
            }
        })
        return exportInfos;
    }

    public getExportInfoBy(name: string): ExportInfo | undefined {
        return this.exportInfoMap.get(name);
    }

    public addExportInfo(exportInfo: ExportInfo, key?: string) {
        this.exportInfoMap.set(key ?? exportInfo.getExportClauseName(), exportInfo);
    }

    public removeExportInfo(exportInfo: ExportInfo, key?: string): void {
        if (key) {
            this.exportInfoMap.delete(key);
            return;
        }
        this.exportInfoMap.delete(exportInfo.getExportClauseName());
    }

    public getProjectName() {
        return this.fileSignature.getProjectName();
    }

    public getModuleName() {
        return this.moduleScene?.getModuleName();
    }

    public setOhPackageJson5Path(ohPackageJson5Path: string[]) {
        this.ohPackageJson5Path = ohPackageJson5Path;
    }

    public getOhPackageJson5Path() {
        return this.ohPackageJson5Path;
    }

    /**
     * Returns the file signature of this file. A file signature consists of project's name and file's name.
     * @returns The file signature of this file.
     */
    public getFileSignature() {
        return this.fileSignature;
    }

    public setFileSignature(fileSignature: FileSignature): void {
        this.fileSignature = fileSignature;
    }

    public getAllNamespacesUnderThisFile(): ArkNamespace[] {
        let namespaces: ArkNamespace[] = [];
        namespaces.push(...this.namespaces.values());
        this.namespaces.forEach((ns) => {
            namespaces.push(...ns.getAllNamespacesUnderThisNamespace());
        });
        return namespaces;
    }

    public getAnonymousClassNumber() {
        return this.anonymousClassNumber++;
    }
}