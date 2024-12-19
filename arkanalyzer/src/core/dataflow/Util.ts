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

import { ArkInvokeStmt } from "../base/Stmt";
import { FunctionType } from "../base/Type";
import { ArkClass } from "../model/ArkClass";
import { ArkMethod } from "../model/ArkMethod";
import { ArkNamespace } from "../model/ArkNamespace";
import { Scene } from "../../Scene";
import { FileSignature } from '../model/ArkSignature';
import { Local } from "../base/Local";
import { AbstractRef, ArkStaticFieldRef, ArkInstanceFieldRef } from "../base/Ref";


export const INTERNAL_PARAMETER_SOURCE: string[] = [
    '@ohos.app.ability.Want.d.ts: Want'
]

export const INTERNAL_SINK_METHOD: string[] = [
    'console.<@%unk/%unk: .log()>',
    'console.<@%unk/%unk: .error()>',
    'console.<@%unk/%unk: .info()>',
    'console.<@%unk/%unk: .warn()>',
    'console.<@%unk/%unk: .assert()>'
]

const filenamePrefix = '@etsSdk/api/'

export function Json2ArkMethod(sdkName:string, str: string, scene: Scene): ArkMethod | null {
    const mes = str.split(': ');
    const fileName = filenamePrefix + mes[0] + ': ';
    const otherMes = mes.slice(1).join(': ').split('.');
    if (otherMes.length < 3) {
        return null;
    }
    const namespaceName = otherMes[0];
    const className = otherMes[1];
    const methodName = otherMes[2].split('(')[0];
    let paramNames: string[] = [];
    if (otherMes[2]) {
        if (!otherMes[2].match(/\((.*?)\)/)) {
            return null;
        }
        paramNames = otherMes[2].match(/\((.*?)\)/)![1].split(',').map((item: string) => item.replace(/\s/g, '')).filter((item: string) => item !== '');
    }
    
    const file = scene.getFile(new FileSignature(sdkName, fileName));
    if (!file) {
        return null;
    }
    let arkClass: ArkClass | null = null;
    if (namespaceName === "_") {
        if (className === '_') {
            arkClass = file.getDefaultClass();
        } else {
            for (const clas of file.getClasses()) {
                if (clas.getName() === className) {
                    arkClass = clas;
                    break;
                }
            }
        }
    } else {
        let arkNamespace: ArkNamespace | null = null;
        for (const ns of file.getNamespaces()) {
            if (ns.getName() === namespaceName) {
                arkNamespace = ns;
                break;
            }
        }
        if (arkNamespace) {
            if (className === '_') {
                arkClass = arkNamespace.getDefaultClass()
            } else {
                for (const clas of arkNamespace.getClasses()) {
                    if (clas.getName() === className) {
                        arkClass = clas;
                        break;
                    }
                }
            }
        } else {
            return null;
        }
    }
    if (!arkClass) {
        return null;
    } else {
        let arkMethod: ArkMethod | null = null;
        for (const method of arkClass.getMethods()) {
            if (method.getName() === methodName) {
                arkMethod = method;
                break;
            }
        }
        if (arkMethod && arkMethod.getParameters().length === paramNames.length) {
            let paramEqual = true;
            for (let i = 0; i < arkMethod.getParameters().length; i++) {
                const param = arkMethod.getParameters()[i]
                if (param.getName() + ':' + param.getType().toString() !== paramNames[i]) {
                    paramEqual = false;
                    break;
                }
            }
            if (paramEqual) {
                return arkMethod;
            }
        } else {
            return null;
        }
    }
    return null;
}

// 如果调用回调函数的函数是项目内函数就不用管，会进函数内部执行，只有是sdk函数才需要分析
export function getRecallMethodInParam(stmt: ArkInvokeStmt): ArkMethod | null {
    for (const param of stmt.getInvokeExpr().getArgs()) {
        if (param.getType() instanceof FunctionType) {
            const methodSignature = (param.getType() as FunctionType).getMethodSignature();
            const method = stmt.getCfg()?.getDeclaringMethod().getDeclaringArkClass().getMethod(methodSignature);
            if (method) {
                return method;
            }
        }
    }
    return null;
}


export function LocalEqual(local1: Local, local2: Local): boolean {
    if (local1.getName() === 'this' && local2.getName() === 'this') {
        return true;
    }
    const method1 = local1.getDeclaringStmt()?.getCfg()?.getDeclaringMethod();
    const method2 = local2.getDeclaringStmt()?.getCfg()?.getDeclaringMethod();
    const nameEqual = local1.getName() === local2.getName();
    return method1 === method2 && nameEqual;
}

export function RefEqual(ref1: AbstractRef, ref2: AbstractRef): boolean {
    if (ref1 instanceof ArkStaticFieldRef && ref2 instanceof ArkStaticFieldRef) {
        return ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    } else if (ref1 instanceof ArkInstanceFieldRef && ref2 instanceof ArkInstanceFieldRef) {
        return LocalEqual(ref1.getBase(), ref2.getBase()) && ref1.getFieldSignature().toString() === ref2.getFieldSignature().toString();
    }
    return false;
}