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

import fs from 'fs';
import path from 'path';

import { SceneConfig, SceneOptions, Sdk } from './Config';
import { ModelUtils } from './core/common/ModelUtils';
import { TypeInference } from './core/common/TypeInference';
import { VisibleValue } from './core/common/VisibleValue';
import { ArkClass } from './core/model/ArkClass';
import { ArkFile } from './core/model/ArkFile';
import { ArkMethod } from './core/model/ArkMethod';
import { ArkNamespace } from './core/model/ArkNamespace';
import { ClassSignature, FileSignature, MethodSignature, NamespaceSignature } from './core/model/ArkSignature';
import Logger, { LOG_MODULE_TYPE } from './utils/logger';
import { Local } from './core/base/Local';
import { buildArkFileFromFile } from './core/model/builder/ArkFileBuilder';
import { fetchDependenciesFromFile, parseJsonText } from './utils/json5parser';
import { getAllFiles } from './utils/getAllFiles';
import { getFileRecursively } from './utils/FileUtils';
import { ArkExport, ExportType } from './core/model/ArkExport';
import { addInitInConstructor, buildDefaultConstructor } from './core/model/builder/ArkMethodBuilder';
import { DEFAULT_ARK_CLASS_NAME, STATIC_INIT_METHOD_NAME } from './core/common/Const';
import { CallGraph } from './callgraph/model/CallGraph';
import { CallGraphBuilder } from './callgraph/model/builder/CallGraphBuilder';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'Scene');

enum SceneBuildStage {
    BUILD_INIT,
    CLASS_DONE,
    METHOD_DONE,
};

/**
 * The Scene class includes everything in the analyzed project.
 * We should be able to re-generate the project's code based on this class.
 */
export class Scene {
    private projectName: string = '';
    private projectFiles: string[] = [];
    private realProjectDir: string = '';

    private moduleScenesMap: Map<string, ModuleScene> = new Map();
    private modulePath2NameMap: Map<string, string> = new Map<string, string>();

    private moduleSdkMap: Map<string, Sdk[]> = new Map();
    private projectSdkMap: Map<string, Sdk> = new Map();

    // values that are visible in curr scope
    private visibleValue: VisibleValue = new VisibleValue();

    // signature string to model
    private filesMap: Map<string, ArkFile> = new Map();
    private namespacesMap: Map<string, ArkNamespace> = new Map();
    private classesMap: Map<string, ArkClass> = new Map();
    private methodsMap: Map<string, ArkMethod> = new Map();
    // TODO: type of key should be signature object
    private sdkArkFilesMap: Map<string, ArkFile> = new Map();
    private sdkGlobalMap: Map<string, ArkExport> = new Map<string, ArkExport>();
    private ohPkgContentMap: Map<string, { [k: string]: unknown }> = new Map<string, { [k: string]: unknown }>();
    private ohPkgFilePath: string = '';
    private ohPkgContent: { [k: string]: unknown } = {};

    private buildStage: SceneBuildStage = SceneBuildStage.BUILD_INIT;
    private options!: SceneOptions;

    constructor() {
    }

    public getOptions(): SceneOptions {
        return this.options;
    }

    public clear(): void {
        this.projectFiles = [];

        this.moduleScenesMap.clear();
        this.modulePath2NameMap.clear();

        this.moduleSdkMap.clear();
        this.projectSdkMap.clear();

        this.filesMap.clear();
        this.namespacesMap.clear();
        this.classesMap.clear();
        this.methodsMap.clear();

        this.sdkArkFilesMap.clear();
        this.sdkGlobalMap.clear();
        this.ohPkgContentMap.clear();
        this.ohPkgContent = {};
    }

    public getStage(): SceneBuildStage {
        return this.buildStage;
    }

    /**
     * Build scene object according to the {@link SceneConfig}. This API implements 3 functions.
     * First is to build scene object from {@link SceneConfig}, second is to generate {@link ArkFile}s,
     * and the last is to collect project import infomation.
     * @param sceneConfig - a sceneConfig object, which is usally defined by user or Json file.
     * @example
     * 1. Build Scene object from scene config

     ```typescript
     // build config
     const projectDir = ... ...;
     const sceneConfig = new SceneConfig();
     sceneConfig.buildFromProjectDir(projectDir);

     // build scene
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     ```
     */
    public buildSceneFromProjectDir(sceneConfig: SceneConfig) {
        this.buildBasicInfo(sceneConfig);
        this.genArkFiles();
    }

    /**
     * Set the basic information of the scene using a config,
     * such as the project's name, real path and files.
     * @param sceneConfig - the config used to set the basic information of scene.
     */
    public buildBasicInfo(sceneConfig: SceneConfig) {
        this.options = sceneConfig.getOptions();
        this.projectName = sceneConfig.getTargetProjectName();
        this.realProjectDir = fs.realpathSync(sceneConfig.getTargetProjectDirectory());
        this.projectFiles = sceneConfig.getProjectFiles();

        const buildProfile = path.join(this.realProjectDir, './build-profile.json5');
        if (fs.existsSync(buildProfile)) {
            let configurationsText: string;
            try {
                configurationsText = fs.readFileSync(buildProfile, 'utf-8');
            } catch (error) {
                logger.error(`Error reading file: ${error}`);
                return;
            }
            const buildProfileJson = parseJsonText(configurationsText);
            const modules = buildProfileJson.modules;
            if (modules instanceof Array) {
                modules.forEach((module) => {
                    this.modulePath2NameMap.set(path.resolve(this.realProjectDir, path.join(module.srcPath)), module.name);
                });
            }
        } else {
            logger.warn('There is no build-profile.json5 for this project.');
        }

        const OhPkgFilePath = path.join(this.realProjectDir, './oh-package.json5');
        if (fs.existsSync(OhPkgFilePath)) {
            this.ohPkgFilePath = OhPkgFilePath;
            this.ohPkgContent = fetchDependenciesFromFile(this.ohPkgFilePath);
            this.ohPkgContentMap.set(OhPkgFilePath, this.ohPkgContent);
        } else {
            logger.warn('This project has no oh-package.json5!');
        }

        // handle sdks
        sceneConfig.getSdksObj()?.forEach((sdk) => {
            if (!sdk.moduleName) {
                this.buildSdk(sdk.name, sdk.path);
                this.projectSdkMap.set(sdk.name, sdk);
            } else {
                let moduleSdks = this.moduleSdkMap.get(sdk.moduleName);
                if (moduleSdks) {
                    moduleSdks.push(sdk);
                } else {
                    this.moduleSdkMap.set(sdk.moduleName, [sdk]);
                }
            }
        });

        this.sdkArkFilesMap.forEach(file => {
            this.inferFile(file);
        });
    }

    private addDefaultConstructors(): void {
        for (const file of this.getFiles()) {
            for (const cls of ModelUtils.getAllClassesInFile(file)) {
                buildDefaultConstructor(cls);
                addInitInConstructor(cls);
            }
        }
    }

    private buildAllMethodBody() {
        this.buildStage = SceneBuildStage.CLASS_DONE;
        for (const file of this.getFiles()) {
            for (const cls of file.getClasses()) {
                for (const method of cls.getMethods(true)) {
                    method.buildBody();
                }
            }
        }
        for (const namespace of this.getNamespacesMap().values()) {
            for (const cls of namespace.getClasses()) {
                for (const method of cls.getMethods(true)) {
                    method.buildBody();
                }
            }
        }

        this.buildStage = SceneBuildStage.METHOD_DONE;
    }

    private genArkFiles() {
        this.projectFiles.forEach((file) => {
            logger.info('=== parse file:', file);
            let arkFile: ArkFile = new ArkFile();
            arkFile.setScene(this);
            buildArkFileFromFile(file, this.realProjectDir, arkFile, this.projectName);
            this.filesMap.set(arkFile.getFileSignature().toMapKey(), arkFile);
        });
        this.buildAllMethodBody();
        this.addDefaultConstructors();
    }

    private buildSdk(sdkName: string, sdkPath: string) {
        const allFiles = getAllFiles(sdkPath, ['.ets', '.ts'], this.options.ignoreFileNames);
        allFiles.forEach((file) => {
            logger.info('=== parse sdk file:', file);
            let arkFile: ArkFile = new ArkFile();
            arkFile.setScene(this);
            buildArkFileFromFile(file, path.normalize(sdkPath), arkFile, sdkName);
            ModelUtils.getAllClassesInFile(arkFile).forEach(cls => cls.getDefaultArkMethod()?.buildBody());
            const fileSig = arkFile.getFileSignature().toMapKey();
            this.sdkArkFilesMap.set(fileSig, arkFile);
            ModelUtils.buildGlobalMap(arkFile, this.sdkGlobalMap);
        });
    }

    /**
     * Build the scene for harmony project. It resolves the file path of the project first, and then fetches dependencies from this file.
     * Next, build a `ModuleScene` for this project to generate {@link ArkFile}. Finally, it build bodies of all methods, generate extended classes, and add DefaultConstructors.
     */
    public buildScene4HarmonyProject() {
        this.modulePath2NameMap.forEach((value, key) => {
            const moduleOhPkgFilePath = path.resolve(key, './oh-package.json5');
            if (fs.existsSync(moduleOhPkgFilePath)) {
                const moduleOhPkgContent = fetchDependenciesFromFile(moduleOhPkgFilePath);
                this.ohPkgContentMap.set(moduleOhPkgFilePath, moduleOhPkgContent);
            }
        });
        this.modulePath2NameMap.forEach((value, key) => {
            let moduleScene = new ModuleScene(this);
            moduleScene.ModuleSceneBuilder(value, key);
            this.moduleScenesMap.set(value, moduleScene);
        });

        this.buildAllMethodBody();
        this.addDefaultConstructors();
    }

    public buildModuleScene(moduleName: string, modulePath: string) {
        if (this.moduleScenesMap.get(moduleName)) {
            return;
        }

        // get oh-package.json5
        const moduleOhPkgFilePath = path.resolve(this.realProjectDir, path.join(modulePath, './oh-package.json5'));
        if (fs.existsSync(moduleOhPkgFilePath)) {
            const moduleOhPkgContent = fetchDependenciesFromFile(moduleOhPkgFilePath);
            this.ohPkgContentMap.set(moduleOhPkgFilePath, moduleOhPkgContent);
        } else {
            logger.warn('Module: ', moduleName, 'has no oh-package.json5.');
        }

        // parse moduleOhPkgContent, get dependencies and build dependent module
        const moduleOhPkgContent = this.ohPkgContentMap.get(moduleOhPkgFilePath);
        if (moduleOhPkgContent) {
            if (moduleOhPkgContent.dependencies instanceof Object) {
                Object.entries(moduleOhPkgContent.dependencies).forEach(([k, v]) => {
                    const pattern = new RegExp('^(\\.\\.\\/\|\\.\\/)');
                    if (typeof (v) === 'string') {
                        let dependencyModulePath: string = '';
                        if (pattern.test(v)) {
                            dependencyModulePath = path.join(moduleOhPkgFilePath, v);
                        } else if (v.startsWith('file:')) {
                            const dependencyFilePath = path.join(moduleOhPkgFilePath, v.replace(/^file:/, ''));
                            const dependencyOhPkgPath = getFileRecursively(path.dirname(dependencyFilePath), 'oh-package.json5');
                            dependencyModulePath = path.dirname(dependencyOhPkgPath);
                        }
                        logger.info('Dependency path: ', dependencyModulePath);
                        const dependencyModuleName = this.modulePath2NameMap.get(dependencyModulePath);
                        if (dependencyModuleName) {
                            this.buildModuleScene(dependencyModuleName, dependencyModulePath);
                        }
                    }
                });
            }
        }

        let moduleScene = new ModuleScene(this);
        moduleScene.ModuleSceneBuilder(moduleName, modulePath);
        this.moduleScenesMap.set(moduleName, moduleScene);

        this.buildAllMethodBody();
    }

    /**
     * Get the absolute path of current project.
     * @returns The real project's directiory.
     * @example
     * 1. get real project directory, such as:
     ```typescript
     let projectDir = projectScene.getRealProjectDir(); 
     ```
     */
    public getRealProjectDir(): string {
        return this.realProjectDir;
    }

    /**
     * Returns the **string** name of the project.
     * @returns The name of the project.
     */
    public getProjectName(): string {
        return this.projectName;
    }

    public getProjectFiles() {
        return this.projectFiles;
    }

    public getSdkGlobal(globalName: string): ArkExport | null {
        return this.sdkGlobalMap.get(globalName) || null;
    }

    /**
     * Returns the file based on its signature.
     * If no file can be found according to the input signature, **null** will be returned.
     * A typical {@link ArkFile} contains: file's name (i.e., its relative path), project's name,
     * project's dir, file's signature etc.
     * @param fileSignature - the signature of file.
     * @returns a file defined by ArkAnalyzer. **null** will be returned if no file could be found.
     * @example
     * 1. get ArkFile based on file signature.

     ```typescript
     if (...) {
     const fromSignature = new FileSignature();
     fromSignature.setProjectName(im.getDeclaringArkFile().getProjectName());
     fromSignature.setFileName(fileName);
     return scene.getFile(fromSignature);
     }
     ```
     */
    public getFile(fileSignature: FileSignature): ArkFile | null {
        if (this.projectName === fileSignature.getProjectName()) {
            return this.filesMap.get(fileSignature.toMapKey()) || null;
        } else {
            return this.sdkArkFilesMap.get(fileSignature.toMapKey()) || null;
        }
    }

    public setFile(file: ArkFile): void {
        this.filesMap.set(file.getFileSignature().toMapKey(), file);
    }

    public hasSdkFile(fileSignature: FileSignature): boolean {
        return this.sdkArkFilesMap.has(fileSignature.toMapKey());
    }

    /**
     * Get files of a {@link Scene}. Generally, a project includes several ets/ts files that define the different class. We need to generate {@link ArkFile} objects from these ets/ts files.
     * @returns The array of {@link ArkFile} from `scene.filesMap.values()`.
     * @example
     * 1. In inferSimpleTypes() to check arkClass and arkMethod.
     * ```typescript
     * public inferSimpleTypes() {
     *   for (let arkFile of this.getFiles()) {
     *       for (let arkClass of arkFile.getClasses()) {
     *           for (let arkMethod of arkClass.getMethods()) {
     *           // ... ...;
     *           }
     *       }
     *   }
     * }
     * ```
     * 2. To iterate each method
     * ```typescript
     * for (const file of this.getFiles()) {
     *     for (const cls of file.getClasses()) {
     *         for (const method of cls.getMethods()) {
     *             // ... ...
     *         }
     *     }
     * }
     *```
     */
    public getFiles(): ArkFile[] {
        return Array.from(this.filesMap.values());
    }

    public getSdkArkFiles(): ArkFile[] {
        return Array.from(this.sdkArkFilesMap.values());
    }

    public getModuleSdkMap() {
        return this.moduleSdkMap;
    }

    public getProjectSdkMap() {
        return this.projectSdkMap;
    }

    public getNamespace(namespaceSignature: NamespaceSignature): ArkNamespace | null {
        if (this.projectName === namespaceSignature.getDeclaringFileSignature().getProjectName()) {
            return this.getNamespacesMap().get(namespaceSignature.toMapKey()) || null;
        } else {
            const arkFile = this.getFile(namespaceSignature.getDeclaringFileSignature());
            const parentNs = namespaceSignature.getDeclaringNamespaceSignature();
            if (parentNs) {
                return arkFile?.getNamespace(parentNs)?.getNamespace(namespaceSignature) || null;
            }
            return arkFile?.getNamespace(namespaceSignature) || null;
        }
    }

    private getNamespacesMap(): Map<string, ArkNamespace> {
        if (this.namespacesMap.size === 0) {
            for (const file of this.getFiles()) {
                ModelUtils.getAllNamespacesInFile(file).forEach((namespace) => {
                    this.namespacesMap.set(namespace.getNamespaceSignature().toMapKey(), namespace);
                });
            }
        }
        return this.namespacesMap;
    }

    public getNamespaces(): ArkNamespace[] {
        return Array.from(this.getNamespacesMap().values());
    }

    /**
     * Returns the class according to the input class signature.
     * @param classSignature - signature of the class to be obtained.
     * @returns A class.
     */
    public getClass(classSignature: ClassSignature, refresh?: boolean): ArkClass | null {
        if (this.projectName === classSignature.getDeclaringFileSignature().getProjectName()) {
            return this.getClassesMap(refresh).get(classSignature.toMapKey()) || null;
        } else {
            const arkFile = this.getFile(classSignature.getDeclaringFileSignature());
            const namespaceSignature = classSignature.getDeclaringNamespaceSignature();
            if (namespaceSignature) {
                return arkFile?.getNamespace(namespaceSignature)?.getClass(classSignature) || null;
            }
            return arkFile?.getClass(classSignature) || null;
        }
    }

    private getClassesMap(refresh?: boolean): Map<string, ArkClass> {
        if (refresh || (this.classesMap.size === 0 && this.buildStage >= SceneBuildStage.CLASS_DONE)) {
            this.classesMap.clear();
            for (const file of this.getFiles()) {
                for (const cls of file.getClasses()) {
                    this.classesMap.set(cls.getSignature().toMapKey(), cls);
                }
            }
            for (const namespace of this.getNamespacesMap().values()) {
                for (const cls of namespace.getClasses()) {
                    this.classesMap.set(cls.getSignature().toMapKey(), cls);
                }
            }
        }
        return this.classesMap;
    }

    public getClasses(refresh?: boolean): ArkClass[] {
        return Array.from(this.getClassesMap(refresh).values());
    }

    public getMethod(methodSignature: MethodSignature, refresh?: boolean): ArkMethod | null {
        if (this.projectName === methodSignature.getDeclaringClassSignature().getDeclaringFileSignature().getProjectName()) {
            return this.getMethodsMap(refresh).get(methodSignature.toMapKey()) || null;
        } else {
            return this.getClass(methodSignature.getDeclaringClassSignature())?.getMethod(methodSignature) || null;
        }
    }

    private getMethodsMap(refresh?: boolean): Map<string, ArkMethod> {
        if (refresh || (this.methodsMap.size === 0 && this.buildStage >= SceneBuildStage.METHOD_DONE)) {
            this.methodsMap.clear();
            for (const cls of this.getClassesMap().values()) {
                for (const method of cls.getMethods(true)) {
                    this.methodsMap.set(method.getSignature().toMapKey(), method);
                }
            }
        }
        return this.methodsMap;
    }

    /**
     * Returns the method associated with the method signature.
     * If no method is associated with this signature, **null** will be returned.
     * An {@link ArkMethod} includes:
     * - Name: the **string** name of method.
     * - Code: the **string** code of the method.
     * - Line: a **number** indicating the line location, initialized as -1.
     * - Column: a **number** indicating the column location, initialized as -1.
     * - Parameters & Types of parameters: the parameters of method and their types.
     * - View tree: the view tree of the method.
     * - ...
     *
     * @param methodSignature - the signature of method.
     * @returns The method associated with the method signature.
     * @example
     * 1. get method from getMethod.

     ```typescript
     const methodSignatures = this.CHA.resolveCall(xxx, yyy);
     for (const methodSignature of methodSignatures) {
     const method = this.scene.getMethod(methodSignature);
     ... ...
     }
     ```
     */
    public getMethods(refresh?: boolean): ArkMethod[] {
        return Array.from(this.getMethodsMap(refresh).values());
    }

    public addToMethodsMap(method: ArkMethod): void {
        this.methodsMap.set(method.getSignature().toMapKey(), method);
    }

    public removeMethod(method: ArkMethod): boolean {
        return this.methodsMap.delete(method.getSignature().toMapKey());
    }

    public removeClass(arkClass: ArkClass): boolean {
        return this.classesMap.delete(arkClass.getSignature().toMapKey());
    }

    public removeNamespace(namespace: ArkNamespace): boolean {
        return this.namespacesMap.delete(namespace.getSignature().toMapKey());
    }

    public removeFile(file: ArkFile): boolean {
        return this.filesMap.delete(file.getFileSignature().toMapKey());
    }

    public hasMainMethod(): boolean {
        return false;
    }

    //Get the set of entry points that are used to build the call graph.
    public getEntryPoints() {
        return [];
    }

    /** get values that is visible in curr scope */
    public getVisibleValue(): VisibleValue {
        return this.visibleValue;
    }

    public getOhPkgContent() {
        return this.ohPkgContent;
    }

    public getOhPkgContentMap() {
        return this.ohPkgContentMap;
    }

    public getOhPkgFilePath() {
        return this.ohPkgFilePath;
    }

    public makeCallGraphCHA(entryPoints: MethodSignature[]): CallGraph {
        let callGraph = new CallGraph(this);
        let callGraphBuilder = new CallGraphBuilder(callGraph, this);
        callGraphBuilder.buildClassHierarchyCallGraph(entryPoints);
        return callGraph;
    }

    public makeCallGraphRTA(entryPoints: MethodSignature[]): CallGraph {
        let callGraph = new CallGraph(this);
        let callGraphBuilder = new CallGraphBuilder(callGraph, this);
        callGraphBuilder.buildRapidTypeCallGraph(entryPoints);
        return callGraph;
    }

    /**
     * Infer type for each non-default method. It infers the type of each field/local/reference.
     * For example, the statement `let b = 5;`, the type of local `b` is `NumberType`; and for the statement `let s = 'hello';`, the type of local `s` is `StringType`. The detailed types are defined in the Type.ts file.
     * @example
     * 1. Infer the type of each class field and method field.

     ```typescript
     const scene = new Scene();
     scene.buildSceneFromProjectDir(sceneConfig);
     scene.inferTypes();
     ```
     */
    public inferTypes() {
        this.filesMap.forEach(file => this.inferFile(file));
        this.getClasses(true);
        this.getMethodsMap(true);
    }

    private inferFile(file: ArkFile): void {
        ModelUtils.getAllClassesInFile(file).forEach(arkClass => {
            TypeInference.inferGenericType(arkClass.getGenericsTypes(), arkClass);
            const defaultArkMethod = arkClass.getDefaultArkMethod();
            if (defaultArkMethod) {
                TypeInference.inferTypeInMethod(defaultArkMethod);
            }
            arkClass.getFields().forEach(arkField => TypeInference.inferTypeInArkField(arkField));
            arkClass.getMethods().forEach(arkMethod => TypeInference.inferTypeInMethod(arkMethod));
        });
    }

    /**
     * Iterate all assignment statements in methods,
     * and set the type of left operand based on the type of right operand
     * if the left operand is a local variable as well as an unknown.
     * @Deprecated
     * @example
     * 1. Infer simple type when scene building.

     ```typescript
     let scene = new Scene();
     scene.buildSceneFromProjectDir(config);
     scene.inferSimpleTypes();
     ```
     */
    public inferSimpleTypes() {

        for (let arkFile of this.getFiles()) {
            for (let arkClass of arkFile.getClasses()) {
                for (let arkMethod of arkClass.getMethods()) {
                    TypeInference.inferSimpleTypeInMethod(arkMethod);
                }
            }
        }
    }

    public getClassMap(): Map<FileSignature | NamespaceSignature, ArkClass[]> {
        const classMap: Map<FileSignature | NamespaceSignature, ArkClass[]> = new Map();
        for (const file of this.getFiles()) {
            const fileClass: ArkClass[] = [];
            const namespaceStack: ArkNamespace[] = [];
            const parentMap: Map<ArkNamespace, ArkNamespace | ArkFile> = new Map();
            const finalNamespaces: ArkNamespace[] = [];
            for (const arkClass of file.getClasses()) {
                fileClass.push(arkClass);
            }
            for (const ns of file.getNamespaces()) {
                namespaceStack.push(ns);
                parentMap.set(ns, file);
            }

            classMap.set(file.getFileSignature(), fileClass);
            // 第一轮遍历，加上每个namespace自己的class
            while (namespaceStack.length > 0) {
                const ns = namespaceStack.shift()!;
                const nsClass: ArkClass[] = [];
                for (const arkClass of ns.getClasses()) {
                    nsClass.push(arkClass);
                }
                classMap.set(ns.getNamespaceSignature(), nsClass);
                if (ns.getNamespaces().length === 0) {
                    finalNamespaces.push(ns);
                } else {
                    for (const nsns of ns.getNamespaces()) {
                        namespaceStack.push(nsns);
                        parentMap.set(nsns, ns);
                    }
                }
            }
            // 第二轮遍历，父节点加上子节点的export的class
            while (finalNamespaces.length > 0) {
                const finalNS = finalNamespaces.shift()!;
                const exportClass = [];
                for (const arkClass of finalNS.getClasses()) {
                    if (arkClass.isExported()) {
                        exportClass.push(arkClass);
                    }
                }
                const parent = parentMap.get(finalNS)!;
                if (parent instanceof ArkNamespace) {
                    classMap.get(parent.getNamespaceSignature())?.push(...exportClass);
                } else if (parent instanceof ArkFile) {
                    classMap.get(parent.getFileSignature())?.push(...exportClass);
                }
                let p = finalNS;
                while (!(parentMap.get(p) instanceof ArkFile) && p.isExported()) {
                    const grandParent = parentMap.get(parentMap.get(p)! as ArkNamespace);
                    if (grandParent instanceof ArkNamespace) {
                        classMap.get(grandParent.getNamespaceSignature())?.push(...exportClass);
                        p = parentMap.get(p)! as ArkNamespace;
                    } else if (grandParent instanceof ArkFile) {
                        classMap.get(grandParent.getFileSignature())?.push(...exportClass);
                        break;
                    }
                }
                if (parent instanceof ArkNamespace && !finalNamespaces.includes(parent)) {
                    finalNamespaces.push(parent);
                }
            }
        }

        for (const file of this.getFiles()) {
            // 文件加上import的class，包括ns的
            const importClasses: ArkClass[] = [];
            const importNameSpaces: ArkNamespace[] = [];
            for (const importInfo of file.getImportInfos()) {
                const importClass = ModelUtils.getClassInImportInfoWithName(importInfo.getImportClauseName(), file);
                if (importClass && !importClasses.includes(importClass)) {
                    importClasses.push(importClass);
                    continue;
                }
                const importNameSpace = ModelUtils.getNamespaceInImportInfoWithName(importInfo.getImportClauseName(), file);
                if (importNameSpace && !importNameSpaces.includes(importNameSpace)) {
                    try {
                        // 遗留问题：只统计了项目文件的namespace，没统计sdk文件内部的引入
                        const importNameSpaceClasses = classMap.get(importNameSpace.getNamespaceSignature())!;
                        importClasses.push(...importNameSpaceClasses.filter(c => !importClasses.includes(c) && c.getName() !== DEFAULT_ARK_CLASS_NAME));
                    } catch {
                    }

                }
            }
            const fileClasses = classMap.get(file.getFileSignature())!;
            fileClasses.push(...importClasses.filter(c => !fileClasses.includes(c)));
            // 子节点加上父节点的class
            const namespaceStack = [...file.getNamespaces()];
            for (const ns of namespaceStack) {
                const nsClasses = classMap.get(ns.getNamespaceSignature())!;
                nsClasses.push(...fileClasses.filter(c => !nsClasses.includes(c) && c.getName() !== DEFAULT_ARK_CLASS_NAME));
            }
            while (namespaceStack.length > 0) {
                const ns = namespaceStack.shift()!;
                const nsClasses = classMap.get(ns.getNamespaceSignature())!;
                for (const nsns of ns.getNamespaces()) {
                    const nsnsClasses = classMap.get(nsns.getNamespaceSignature())!;
                    nsnsClasses.push(...nsClasses.filter(c => !nsnsClasses.includes(c) && c.getName() !== DEFAULT_ARK_CLASS_NAME));
                    namespaceStack.push(nsns);
                }
            }
        }
        return classMap;
    }

    public getGlobalVariableMap(): Map<FileSignature | NamespaceSignature, Local[]> {
        const globalVariableMap: Map<FileSignature | NamespaceSignature, Local[]> = new Map();
        for (const file of this.getFiles()) {
            const namespaceStack: ArkNamespace[] = [];
            const parentMap: Map<ArkNamespace, ArkNamespace | ArkFile> = new Map();
            const finalNamespaces: ArkNamespace[] = [];
            const globalLocals: Local[] = [];
            file.getDefaultClass()?.getDefaultArkMethod()!.getBody()?.getLocals().forEach(local => {
                if (local.getDeclaringStmt() && local.getName() !== 'this' && local.getName()[0] !== '$') {
                    globalLocals.push(local);
                }
            });
            globalVariableMap.set(file.getFileSignature(), globalLocals);
            for (const ns of file.getNamespaces()) {
                namespaceStack.push(ns);
                parentMap.set(ns, file);
            }
            // 第一轮遍历，加上每个namespace自己的local
            while (namespaceStack.length > 0) {
                const ns = namespaceStack.shift()!;
                const nsGlobalLocals: Local[] = [];
                ns.getDefaultClass().getDefaultArkMethod()!.getBody()?.getLocals().forEach(local => {
                    if (local.getDeclaringStmt() && local.getName() !== 'this' && local.getName()[0] !== '$') {
                        nsGlobalLocals.push(local);
                    }
                });
                globalVariableMap.set(ns.getNamespaceSignature(), nsGlobalLocals);
                if (ns.getNamespaces().length === 0) {
                    finalNamespaces.push(ns);
                } else {
                    for (const nsns of ns.getNamespaces()) {
                        namespaceStack.push(nsns);
                        parentMap.set(nsns, ns);
                    }
                }
            }
            // 第二轮遍历，父节点加上子节点的export的local
            while (finalNamespaces.length > 0) {
                const finalNS = finalNamespaces.shift()!;
                const exportLocal = [];
                for (const exportInfo of finalNS.getExportInfos()) {
                    if (exportInfo.getExportClauseType() === ExportType.LOCAL && exportInfo.getArkExport()) {
                        exportLocal.push(exportInfo.getArkExport() as Local);
                    }
                }
                const parent = parentMap.get(finalNS)!;
                if (parent instanceof ArkNamespace) {
                    globalVariableMap.get(parent.getNamespaceSignature())?.push(...exportLocal);
                } else if (parent instanceof ArkFile) {
                    globalVariableMap.get(parent.getFileSignature())?.push(...exportLocal);
                }
                let p = finalNS;
                while (!(parentMap.get(p) instanceof ArkFile) && p.isExported()) {
                    const grandParent = parentMap.get(parentMap.get(p)! as ArkNamespace);
                    if (grandParent instanceof ArkNamespace) {
                        globalVariableMap.get(grandParent.getNamespaceSignature())?.push(...exportLocal);
                        p = parentMap.get(p)! as ArkNamespace;
                    } else if (grandParent instanceof ArkFile) {
                        globalVariableMap.get(grandParent.getFileSignature())?.push(...exportLocal);
                        break;
                    }
                }
                if (parent instanceof ArkNamespace && !finalNamespaces.includes(parent)) {
                    finalNamespaces.push(parent);
                }
            }
        }

        for (const file of this.getFiles()) {
            // 文件加上import的local，包括ns的
            const importLocals: Local[] = [];
            const importNameSpaces: ArkNamespace[] = [];
            for (const importInfo of file.getImportInfos()) {
                const importLocal = ModelUtils.getLocalInImportInfoWithName(importInfo.getImportClauseName(), file);
                if (importLocal && !importLocals.includes(importLocal)) {
                    importLocals.push(importLocal);
                }
                const importNameSpace = ModelUtils.getNamespaceInImportInfoWithName(importInfo.getImportClauseName(), file);
                if (importNameSpace && !importNameSpaces.includes(importNameSpace)) {
                    try {
                        // 遗留问题：只统计了项目文件，没统计sdk文件内部的引入
                        const importNameSpaceClasses = globalVariableMap.get(importNameSpace.getNamespaceSignature())!;
                        importLocals.push(...importNameSpaceClasses.filter(c => !importLocals.includes(c) && c.getName() !== DEFAULT_ARK_CLASS_NAME));
                    } catch {
                    }

                }
            }
            const fileLocals = globalVariableMap.get(file.getFileSignature())!;
            fileLocals.push(...importLocals.filter(c => !fileLocals.includes(c)));
            // 子节点加上父节点的local
            const namespaceStack = [...file.getNamespaces()];
            for (const ns of namespaceStack) {
                const nsLocals = globalVariableMap.get(ns.getNamespaceSignature())!;
                const nsLocalNameSet = new Set<string>(nsLocals.map(item => item.getName()));
                for (const local of fileLocals) {
                    if (!nsLocalNameSet.has(local.getName())) {
                        nsLocals.push(local);
                    }
                }
            }
            while (namespaceStack.length > 0) {
                const ns = namespaceStack.shift()!;
                const nsLocals = globalVariableMap.get(ns.getNamespaceSignature())!;
                for (const nsns of ns.getNamespaces()) {
                    const nsnsLocals = globalVariableMap.get(nsns.getNamespaceSignature())!;
                    const nsnsLocalNameSet = new Set<string>(nsnsLocals.map(item => item.getName()));
                    for (const local of nsLocals) {
                        if (!nsnsLocalNameSet.has(local.getName())) {
                            nsnsLocals.push(local);
                        }
                    }
                    namespaceStack.push(nsns);
                }
            }
        }
        return globalVariableMap;
    }

    public getStaticInitMethods(): ArkMethod[] {
        const staticInitMethods: ArkMethod[] = [];
        for (const method of Array.from(this.getMethodsMap(true).values())) {
            if (method.getName() === STATIC_INIT_METHOD_NAME) {
                staticInitMethods.push(method);
            }
        }
        return staticInitMethods;
    }

    public buildClassDone(): boolean {
        return this.buildStage >= SceneBuildStage.CLASS_DONE;
    }

    public getModuleScene(moduleName: string) {
        return this.moduleScenesMap.get(moduleName);
    }

    public getModuleSceneMap(): Map<string, ModuleScene> {
        return this.moduleScenesMap;
    }
}

export class ModuleScene {
    private projectScene: Scene;
    private moduleName: string = '';
    private modulePath: string = '';

    private moduleOhPkgFilePath: string = '';
    private ohPkgContent: { [k: string]: unknown } = {};

    constructor(projectScene: Scene) {
        this.projectScene = projectScene;
    }

    public ModuleSceneBuilder(moduleName: string, modulePath: string, recursively: boolean = false): void {
        this.moduleName = moduleName;
        this.modulePath = modulePath;

        this.getModuleOhPkgFilePath();

        if (this.moduleOhPkgFilePath) {
            this.ohPkgContent = fetchDependenciesFromFile(this.moduleOhPkgFilePath);
        } else {
            logger.warn('This module has no oh-package.json5!');
        }

        this.genArkFiles();
    }

    /**
     * get oh-package.json5
     */
    private getModuleOhPkgFilePath() {
        const moduleOhPkgFilePath = path.resolve(this.projectScene.getRealProjectDir(), path.join(this.modulePath, './oh-package.json5'));
        if (fs.existsSync(moduleOhPkgFilePath)) {
            this.moduleOhPkgFilePath = moduleOhPkgFilePath;
        }
    }

    /**
     * get nodule name
     * @returns return module name
     */
    public getModuleName(): string {
        return this.moduleName;
    }

    public getModulePath(): string {
        return this.modulePath;
    }

    public getOhPkgFilePath() {
        return this.moduleOhPkgFilePath;
    }

    public getOhPkgContent() {
        return this.ohPkgContent;
    }

    private genArkFiles() {
        getAllFiles(this.modulePath, ['.ets', '.ts'], this.projectScene.getOptions().ignoreFileNames).forEach((file) => {
            logger.info('=== parse file:', file);
            let arkFile: ArkFile = new ArkFile();
            arkFile.setScene(this.projectScene);
            arkFile.setModuleScene(this);
            buildArkFileFromFile(file, this.projectScene.getRealProjectDir(), arkFile,
                this.projectScene.getProjectName());
            this.projectScene.setFile(arkFile);
        });
    }
}