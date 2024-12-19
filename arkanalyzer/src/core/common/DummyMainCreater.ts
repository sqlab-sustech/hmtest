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
import { Scene } from '../../Scene';
import {
    COMPONENT_LIFECYCLE_METHOD_NAME,
    getAbilities,
    getCallbackMethodFromStmt,
    LIFECYCLE_METHOD_NAME,
} from '../../utils/entryMethodUtils';
import { Constant } from '../base/Constant';
import {
    AbstractInvokeExpr,
    ArkConditionExpr,
    ArkInstanceInvokeExpr,
    ArkNewExpr,
    ArkStaticInvokeExpr,
    RelationalBinaryOperator,
} from '../base/Expr';
import { Local } from '../base/Local';
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnVoidStmt } from '../base/Stmt';
import { ClassType, NumberType, Type, UnclearReferenceType } from '../base/Type';
import { BasicBlock } from '../graph/BasicBlock';
import { Cfg } from '../graph/Cfg';
import { ArkBody } from '../model/ArkBody';
import { ArkClass } from '../model/ArkClass';
import { ArkFile } from '../model/ArkFile';
import { ArkMethod } from '../model/ArkMethod';
import { ArkNamespace } from '../model/ArkNamespace';
import { ClassSignature, FileSignature, MethodSignature } from '../model/ArkSignature';
import { ArkSignatureBuilder } from '../model/builder/ArkSignatureBuilder';
import { CONSTRUCTOR_NAME } from './TSConst';
import { fetchDependenciesFromFile } from '../../utils/json5parser';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { checkAndUpdateMethod } from '../model/builder/ArkMethodBuilder';
import { ValueUtil } from './ValueUtil';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'Scene');

/**
收集所有的onCreate，onStart等函数，构造一个虚拟函数，具体为：
%statInit()
...
count = 0
while (true) {
    if (count === 1) {
        temp1 = new ability
        temp2 = new want
        temp1.onCreate(temp2)
    }
    if (count === 2) {
        onDestroy()
    }
    ...
    if (count === *) {
        callbackMethod1()
    }
    ...
}
return
如果是instanceInvoke还要先实例化对象，如果是其他文件的类或者方法还要添加import信息
 */

export class DummyMainCreater {

    private entryMethods: ArkMethod[] = [];
    private classLocalMap: Map<ArkMethod, Local | null> = new Map();
    private dummyMain: ArkMethod = new ArkMethod();
    private scene: Scene;
    private tempLocalIndex: number = 0;
    private builtInClass: Map<string, ArkClass> = new Map;

    constructor(scene: Scene) {
        this.scene = scene;
        // Currently get entries from module.json5 can't visit all of abilities
        // Todo: handle ablity/component jump, then get entries from module.json5
        this.entryMethods = this.getMethodsFromAllAbilities();
        this.entryMethods.push(...this.getEntryMethodsFromComponents());
        this.entryMethods.push(...this.getCallbackMethods());
        this.buildBuiltInClass();
    }

    private buildBuiltInClass() {
        for (const sdkFile of this.scene.getSdkArkFiles()) {
            if (sdkFile.getName() === 'api\\@ohos.app.ability.Want.d.ts') {
                const arkClass = sdkFile.getClassWithName('Want')!;
                this.builtInClass.set('Want', arkClass);
            }
        }
    }

    public setEntryMethods(methods: ArkMethod[]): void {
        this.entryMethods = methods;
    }

    public createDummyMain(): void {
        const dummyMainFile = new ArkFile();
        dummyMainFile.setScene(this.scene);
        const dummyMainFileSignature = new FileSignature(this.scene.getProjectName(), '@dummyFile')
        dummyMainFile.setFileSignature(dummyMainFileSignature)
        this.scene.setFile(dummyMainFile);
        const dummyMainClass = new ArkClass();
        dummyMainClass.setDeclaringArkFile(dummyMainFile);
        const dummyMainClassSignature = new ClassSignature('@dummyClass',
            dummyMainClass.getDeclaringArkFile().getFileSignature(), dummyMainClass.getDeclaringArkNamespace()?.getSignature() || null);
        dummyMainClass.setSignature(dummyMainClassSignature);
        dummyMainFile.addArkClass(dummyMainClass);

        this.dummyMain = new ArkMethod();
        this.dummyMain.setDeclaringArkClass(dummyMainClass);
        const methodSubSignature = ArkSignatureBuilder.buildMethodSubSignatureFromMethodName('@dummyMain');
        const methodSignature = new MethodSignature(this.dummyMain.getDeclaringArkClass().getSignature(),
            methodSubSignature);
        this.dummyMain.setImplementationSignature(methodSignature);
        this.dummyMain.setLineCol(0);
        checkAndUpdateMethod(this.dummyMain, dummyMainClass);
        dummyMainClass.addMethod(this.dummyMain);

        for (const method of this.entryMethods) {
            if (method.getDeclaringArkClass().isDefaultArkClass()) {
                this.classLocalMap.set(method, null);
            } else {
                const declaringArkClass = method.getDeclaringArkClass();
                let newLocal: Local | null = null;
                for (const local of this.classLocalMap.values()) {
                    if ((local?.getType() as ClassType).getClassSignature() === declaringArkClass.getSignature()) {
                        newLocal = local;
                        break;
                    }
                }
                if (!newLocal) {
                    newLocal = new Local('temp' + this.tempLocalIndex, new ClassType(declaringArkClass.getSignature()));
                    this.tempLocalIndex++;
                }
                this.classLocalMap.set(method, newLocal);
            }
        }
        const localSet = new Set(Array.from(this.classLocalMap.values()).filter((value): value is Local => value !== null));
        const dummyBody = new ArkBody(localSet, this.createDummyMainCfg());
        this.dummyMain.setBody(dummyBody)
        this.addCfg2Stmt()
        this.scene.addToMethodsMap(this.dummyMain);
    }

    private createDummyMainCfg(): Cfg {
        const dummyCfg = new Cfg();
        dummyCfg.setDeclaringMethod(this.dummyMain);

        const firstBlock = new BasicBlock();

        let isStartingStmt = true;
        for (const method of this.scene.getStaticInitMethods()) {
            const staticInvokeExpr = new ArkStaticInvokeExpr(method.getSignature(), []);
            const invokeStmt = new ArkInvokeStmt(staticInvokeExpr);
            if (isStartingStmt) {
                dummyCfg.setStartingStmt(invokeStmt);
                isStartingStmt = false;
            }
            firstBlock.addStmt(invokeStmt);
        }

        const locals = Array.from(new Set(this.classLocalMap.values()));
        for (const local of locals) {
            if (!local) {
                continue;
            }
            let clsType = local.getType() as ClassType
            let cls = this.scene.getClass(clsType.getClassSignature());
            if (!cls) {
                continue;
            }
            const assStmt = new ArkAssignStmt(local!, new ArkNewExpr(clsType));
            firstBlock.addStmt(assStmt);
            let consMtd = cls.getMethodWithName(CONSTRUCTOR_NAME);
            if (consMtd) {
                let ivkExpr = new ArkInstanceInvokeExpr(local, consMtd.getSignature(), [])
                let ivkStmt = new ArkInvokeStmt(ivkExpr);
                firstBlock.addStmt(ivkStmt);
            }
        }

        const countLocal = new Local('count', NumberType.getInstance());
        const zero = ValueUtil.getOrCreateNumberConst(0);
        const countAssignStmt = new ArkAssignStmt(countLocal, zero);

        const truE = ValueUtil.getBooleanConstant(true);
        const conditionTrue = new ArkConditionExpr(truE, zero, RelationalBinaryOperator.Equality);
        const whileStmt = new ArkIfStmt(conditionTrue);
        firstBlock.addStmt(countAssignStmt);

        dummyCfg.addBlock(firstBlock);
        dummyCfg.setStartingStmt(firstBlock.getStmts()[0]);

        const whileBlock = new BasicBlock();
        whileBlock.addStmt(whileStmt);
        dummyCfg.addBlock(whileBlock);
        firstBlock.addSuccessorBlock(whileBlock);
        whileBlock.addPredecessorBlock(firstBlock);
        let lastBlocks: BasicBlock[] = [whileBlock];

        let count = 0;
        for (const method of this.entryMethods) {
            count++;
            const condition = new ArkConditionExpr(countLocal, new Constant(count.toString(), NumberType.getInstance()), RelationalBinaryOperator.Equality);
            const ifStmt = new ArkIfStmt(condition);
            const ifBlock = new BasicBlock();
            ifBlock.addStmt(ifStmt);
            dummyCfg.addBlock(ifBlock);
            for (const block of lastBlocks) {
                ifBlock.addPredecessorBlock(block);
                block.addSuccessorBlock(ifBlock);
            }

            const invokeBlock = new BasicBlock();
            const paramLocals: Local[] = [];
            let paramIdx = 0;
            for (const param of method.getParameters()) {
                let paramType: Type | undefined = param.getType();
                let checkMethod = method;
                // In ArkIR from abc scenario, param type is undefined in some cases
                // Then try to get it from super class(SDK)
                // TODO - need handle method overload to get the correct method
                if (!paramType) {
                    let superCls = method.getDeclaringArkClass().getSuperClass();
                    let methodInSuperCls = superCls?.getMethodWithName(method.getName());
                    if (methodInSuperCls) {
                        paramType = methodInSuperCls.getParameters().at(paramIdx)?.getType();
                        checkMethod = methodInSuperCls;
                    }
                }
                const paramLocal = new Local('temp' + this.tempLocalIndex++, paramType);
                paramLocals.push(paramLocal);
                if (paramType instanceof ClassType) {
                    const assStmt = new ArkAssignStmt(paramLocal, new ArkNewExpr(paramType));
                    invokeBlock.addStmt(assStmt);
                } else if (paramType instanceof UnclearReferenceType) {
                    const arkClass = this.getArkClassFromParamType(paramType.getName(), checkMethod.getDeclaringArkFile());
                    if (arkClass) {
                        const classType = new ClassType(arkClass.getSignature());
                        paramLocal.setType(classType);
                        const assStmt = new ArkAssignStmt(paramLocal, new ArkNewExpr(classType));
                        invokeBlock.addStmt(assStmt);
                    }
                }
                paramIdx++;
            }
            const local = this.classLocalMap.get(method);
            let invokeExpr: AbstractInvokeExpr;
            if (local) {
                invokeExpr = new ArkInstanceInvokeExpr(local, method.getSignature(), paramLocals);
            } else {
                invokeExpr = new ArkStaticInvokeExpr(method.getSignature(), paramLocals);
            }
            const invokeStmt = new ArkInvokeStmt(invokeExpr);
            invokeBlock.addStmt(invokeStmt);
            dummyCfg.addBlock(invokeBlock);
            ifBlock.addSuccessorBlock(invokeBlock);
            invokeBlock.addPredecessorBlock(ifBlock);
            lastBlocks = [ifBlock, invokeBlock];
        }
        for (const block of lastBlocks) {
            block.addSuccessorBlock(whileBlock);
            whileBlock.addPredecessorBlock(block);
        }
        const returnStmt = new ArkReturnVoidStmt();
        const returnBlock = new BasicBlock();
        returnBlock.addStmt(returnStmt);
        dummyCfg.addBlock(returnBlock);
        whileBlock.addSuccessorBlock(returnBlock);
        returnBlock.addPredecessorBlock(whileBlock);

        return dummyCfg;
    }

    private getArkClassFromParamType(name: string, file: ArkFile): ArkClass | null {
        if (name.includes('.')) {
            const nsName = name.split('.')[0];
            const clsName = name.split('.')[1];
            const importInfo = file.getImportInfoBy(nsName);
            const arkExport = importInfo?.getLazyExportInfo()?.getArkExport();
            if (arkExport instanceof ArkNamespace) {
                const arkClass = arkExport.getClassWithName(clsName);
                if (arkClass) {
                    return arkClass;
                }
            }
        } else {
            const importInfo = file.getImportInfoBy(name);
            const arkExport = importInfo?.getLazyExportInfo()?.getArkExport();
            if (arkExport instanceof ArkClass) {
                return arkExport;
            }
        }
        return null;
    }

    private addCfg2Stmt() {
        const cfg = this.dummyMain.getCfg();
        if (!cfg) {
            return;
        }
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }

    public getDummyMain(): ArkMethod {
        return this.dummyMain;
    }

    private getEntryMethodsFromComponents(): ArkMethod[] {
        const COMPONENT_BASE_CLASSES = ['CustomComponent', 'ViewPU'];
        let methods: ArkMethod[] = [];
        this.scene.getClasses()
            .filter(cls => {
                if (COMPONENT_BASE_CLASSES.includes(cls.getSuperClassName())) {
                    return true;
                }
                if (cls.hasDecorator('Component')) {
                    return true;
                }
                return false;
            })
            .forEach(cls => {
                methods.push(...cls.getMethods().filter(mtd => COMPONENT_LIFECYCLE_METHOD_NAME.includes(mtd.getName())));
            });
        return methods;
    }

    private classInheritsAbility(arkClass: ArkClass): boolean {
        const ABILITY_BASE_CLASSES = ['UIExtensionAbility', 'Ability', 'FormExtensionAbility', 'UIAbility', 'BackupExtensionAbility'];
        let superClass = arkClass.getSuperClass();
        while (superClass) {
            if (ABILITY_BASE_CLASSES.includes(superClass.getName())) {
                return true;
            }
            superClass = superClass.getSuperClass();
        }
        return false;
    }

    public getMethodsFromAllAbilities(): ArkMethod[] {
        let methods: ArkMethod[] = [];
        this.scene.getClasses()
            .filter(cls => this.classInheritsAbility(cls))
            .forEach(cls => {
                methods.push(...cls.getMethods().filter(mtd => LIFECYCLE_METHOD_NAME.includes(mtd.getName())));
            });
        return methods;
    }

    public getEntryMethodsFromModuleJson5(): ArkMethod[] {
        const projectDir = this.scene.getRealProjectDir();

        const buildProfile = path.join(projectDir, 'build-profile.json5');
        if (!fs.existsSync(buildProfile)) {
            logger.error(`${buildProfile} is not exists.`);
            return [];
        }

        const abilities: ArkClass[] = [];
        const buildProfileConfig = fetchDependenciesFromFile(buildProfile);
        let modules: Array<any> | undefined;
        if (buildProfileConfig instanceof Object) {
            Object.entries(buildProfileConfig).forEach(([k, v]) => {
                if (k === 'modules' && Array.isArray(v)) {
                    modules = v;
                    return;
                }
            });
        }
        if (Array.isArray(modules)) {
            for (const module of modules) {
                const modulePath = path.join(projectDir, module.srcPath);
                let moduleAbilities = this.getAbilitiesByParseModuleJson(modulePath);
                abilities.push(...moduleAbilities);
            }
        }

        const entryMethods: ArkMethod[] = [];
        for (const ability of abilities) {
            const abilityEntryMethods: ArkMethod[] = [];
            let cls: ArkClass = ability;
            for (const method of cls.getMethods()) {
                if (method.isPrivate()) {
                    continue;
                }
                for (const mtd of abilityEntryMethods) {
                    if (mtd.getName() === method.getName()) {
                        continue;
                    }
                }
                if (LIFECYCLE_METHOD_NAME.includes(method.getName()) && !entryMethods.includes(method)) {
                    abilityEntryMethods.push(method);
                }
            }
            entryMethods.push(...abilityEntryMethods);
        }
        return entryMethods;
    }

    public getAbilitiesByParseModuleJson(modulePath: string): ArkClass[] {
        const jsonPath = path.join(modulePath, '/src/main/module.json5');

        let abilities: ArkClass[] = [];
        const ABILITY_NAMES = ['abilities', 'extensionAbilities'];
        try {
            const config = fetchDependenciesFromFile(jsonPath);
            const configModule = config.module;
            if (configModule instanceof Object) {
                Object.entries(configModule).forEach(([k, v]) => {
                    if (ABILITY_NAMES.includes(k)) {
                        const moduleAbilities = getAbilities(v, modulePath, this.scene);
                        for (const ability of moduleAbilities) {
                            if (!abilities.includes(ability)) {
                                abilities.push(ability);
                            }
                        }
                    }
                });
            }
        } catch (err) {
            logger.error(err);
        }

        return abilities;
    }

    public getCallbackMethods(): ArkMethod[] {
        const callbackMethods: ArkMethod[] = [];
        this.scene.getMethods().forEach(method => {
            if (!method.getCfg()) {
                return;
            }
            method.getCfg()!.getBlocks().forEach(block => {
                block.getStmts().forEach(stmt => {
                    const cbMethod = getCallbackMethodFromStmt(stmt, this.scene);
                    if (cbMethod && !callbackMethods.includes(cbMethod)) {
                        callbackMethods.push(cbMethod);
                    }
                });
            });
        });
        return callbackMethods;
    }
}
