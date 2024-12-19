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

import { Constant } from '../../core/base/Constant';
import {
    ArkInstanceInvokeExpr,
    ArkNormalBinopExpr,
    ArkStaticInvokeExpr,
    NormalBinaryOperator,
} from '../../core/base/Expr';
import { Local } from '../../core/base/Local';
import { ArkAssignStmt, Stmt } from '../../core/base/Stmt';
import {
    COMPONENT_BRANCH_FUNCTION,
    COMPONENT_CREATE_FUNCTION,
    COMPONENT_IF,
    COMPONENT_POP_FUNCTION,
    isEtsSystemComponent,
    SPECIAL_CONTAINER_COMPONENT,
} from '../../core/common/EtsConst';
import { ArkClass, ClassCategory } from '../../core/model/ArkClass';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { ANONYMOUS_CLASS_PREFIX, ANONYMOUS_METHOD_PREFIX, DEFAULT_ARK_CLASS_NAME } from '../../core/common/Const';
import { ClassSignature } from '../../core/model/ArkSignature';
import { ArkNamespace } from '../../core/model/ArkNamespace';
import ts from 'ohos-typescript';
import { TEMP_LOCAL_PREFIX } from '../../core/common/Const';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'SourceUtils');

export const CLASS_CATEGORY_COMPONENT = 100;

export class SourceUtils {
    public static classOriginTypeToString = new Map<number, string>([
        [ClassCategory.CLASS, 'class'],
        [ClassCategory.STRUCT, 'struct'],
        [ClassCategory.INTERFACE, 'interface'],
        [ClassCategory.ENUM, 'enum'],
        [ClassCategory.TYPE_LITERAL, 'typeliteral'],
        [ClassCategory.OBJECT, 'object'],
        [CLASS_CATEGORY_COMPONENT, 'component'],
    ]);

    public static isAnonymousClass(name: string): boolean {
        return name.startsWith(ANONYMOUS_CLASS_PREFIX);
    }

    public static isDefaultClass(name: string): boolean {
        return name === DEFAULT_ARK_CLASS_NAME;
    }

    public static isAnonymousMethod(name: string): boolean {
        return name.startsWith(ANONYMOUS_METHOD_PREFIX);
    }

    public static isConstructorMethod(name: string): boolean {
        return name === 'constructor';
    }

    public static isDeIncrementStmt(stmt: Stmt | null, op: NormalBinaryOperator): boolean {
        if (!(stmt instanceof ArkAssignStmt)) {
            return false;
        }

        let leftOp = stmt.getLeftOp();
        let rightOp = stmt.getRightOp();
        if (!(leftOp instanceof Local) || !(rightOp instanceof ArkNormalBinopExpr)) {
            return false;
        }

        let op1 = rightOp.getOp1();
        let op2 = rightOp.getOp2();
        let operator = rightOp.getOperator();
        if (!(op1 instanceof Local) || !(op2 instanceof Constant)) {
            return false;
        }

        return leftOp.getName() === op1.getName() && operator === op && op2.getValue() === '1';
    }

    public static isTemp(name: string): boolean {
        return name.startsWith(TEMP_LOCAL_PREFIX);
    }

    public static getOriginType(cls: ArkClass): number {
        if (cls.hasComponentDecorator()) {
            return CLASS_CATEGORY_COMPONENT;
        }
        return cls.getCategory();
    }

    public static isComponentPop(invokeExpr: ArkStaticInvokeExpr): boolean {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();

        if (
            methodName === COMPONENT_POP_FUNCTION &&
            (isEtsSystemComponent(className) || SPECIAL_CONTAINER_COMPONENT.has(className))
        ) {
            return true;
        }

        return false;
    }

    public static isComponentCreate(invokeExpr: ArkStaticInvokeExpr): boolean {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();

        if (
            methodName === COMPONENT_CREATE_FUNCTION &&
            (isEtsSystemComponent(className) || SPECIAL_CONTAINER_COMPONENT.has(className))
        ) {
            return true;
        }

        return false;
    }

    public static isComponentAttributeInvoke(
        invokeExpr: ArkInstanceInvokeExpr,
        visitor: Set<ArkInstanceInvokeExpr> = new Set()
    ): boolean {
        if (visitor.has(invokeExpr)) {
            return false;
        }
        visitor.add(invokeExpr);
        let base = invokeExpr.getBase();
        if (!(base instanceof Local)) {
            logger.error(`SourceUtils->isComponentAttributeInvoke illegal invoke expr ${invokeExpr}`);
            return false;
        }
        let stmt = base.getDeclaringStmt();
        if (!stmt || !(stmt instanceof ArkAssignStmt)) {
            return false;
        }

        let rightOp = stmt.getRightOp();
        if (rightOp instanceof ArkInstanceInvokeExpr) {
            return SourceUtils.isComponentAttributeInvoke(rightOp, visitor);
        }

        if (rightOp instanceof ArkStaticInvokeExpr) {
            return SourceUtils.isComponentCreate(rightOp);
        }

        return false;
    }

    public static isComponentIfBranchInvoke(invokeExpr: ArkStaticInvokeExpr): boolean {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();

        if (className === COMPONENT_IF && methodName === COMPONENT_BRANCH_FUNCTION) {
            return true;
        }
        return false;
    }

    public static isComponentIfElseInvoke(invokeExpr: ArkStaticInvokeExpr): boolean {
        let className = invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName();
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();

        if (className === COMPONENT_IF && methodName === COMPONENT_BRANCH_FUNCTION) {
            let arg0 = invokeExpr.getArg(0) as Constant;
            if (arg0.getValue() === '1') {
                return true;
            }
        }
        return false;
    }

    public static getStaticInvokeClassFullName(
        classSignature: ClassSignature,
        namespace: ArkNamespace | undefined
    ): string {
        let namespaceName = classSignature.getDeclaringNamespaceSignature()?.getNamespaceName();
        let className = classSignature.getClassName();

        let code: string[] = [];
        if (namespaceName && namespaceName.length > 0 && namespaceName !== namespace?.getName()) {
            code.push(namespaceName);
        }

        if (className && className.length > 0 && !SourceUtils.isDefaultClass(className)) {
            code.push(className);
        }
        return code.join('.');
    }

    public static isIdentifierText(text: string): boolean {
        let ch = text.charCodeAt(0);
        if (!ts.isIdentifierStart(ch, ts.ScriptTarget.Latest)) {
            return false;
        }

        for (let i = 1; i < text.length; i++) {
            if (!ts.isIdentifierPart(text.charCodeAt(i), ts.ScriptTarget.Latest)) {
                return false;
            }
        }

        return true;
    }

    public static escape(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/\f/g, `\\f`)
            .replace(/\n/g, `\\n`)
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\v/g, '\\v')
            .replace(/\?/g, '\\?')
            .replace(/\'/g, "\\'")
            .replace(/\"/g, '\\"');
    }
}
