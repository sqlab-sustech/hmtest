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
    AbstractBinopExpr,
    AbstractExpr,
    ArkAwaitExpr,
    ArkCastExpr,
    ArkDeleteExpr,
    ArkInstanceInvokeExpr,
    ArkInstanceOfExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkNormalBinopExpr,
    ArkStaticInvokeExpr,
    ArkTypeOfExpr,
    ArkUnopExpr,
    ArkYieldExpr,
    NormalBinaryOperator,
} from '../../core/base/Expr';
import { Local } from '../../core/base/Local';
import { ArkClass, ClassCategory } from '../../core/model/ArkClass';
import { ArkMethod } from '../../core/model/ArkMethod';
import { ClassSignature, MethodSignature } from '../../core/model/ArkSignature';
import { ArkCodeBuffer } from '../ArkStream';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { SourceUtils } from './SourceUtils';
import { SourceMethod } from './SourceMethod';
import {
    ArrayType,
    ClassType,
    FunctionType,
    GenericType,
    LiteralType,
    PrimitiveType,
    StringType,
    Type,
    UnclearReferenceType,
    UnionType,
    UnknownType,
    VoidType,
} from '../../core/base/Type';
import { SourceClass } from './SourceClass';
import { Value } from '../../core/base/Value';
import { AbstractRef, ArkArrayRef, ArkInstanceFieldRef, ArkStaticFieldRef, ArkThisRef } from '../../core/base/Ref';
import { ArkFile } from '../../core/model/ArkFile';
import {
    COMPONENT_CREATE_FUNCTION,
    COMPONENT_CUSTOMVIEW,
    COMPONENT_IF,
    COMPONENT_POP_FUNCTION,
} from '../../core/common/EtsConst';
import { INSTANCE_INIT_METHOD_NAME } from '../../core/common/Const';
import { ArkAssignStmt } from '../../core/base/Stmt';
import { ArkNamespace } from '../../core/model/ArkNamespace';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'SourceTransformer');

export interface TransformerContext {
    getArkFile(): ArkFile;

    getDeclaringArkNamespace(): ArkNamespace | undefined;

    getMethod(signature: MethodSignature): ArkMethod | null;

    getClass(signature: ClassSignature): ArkClass | null;

    getPrinter(): ArkCodeBuffer;

    transTemp2Code(temp: Local): string;

    isInBuilderMethod(): boolean;
}

export class SourceTransformer {
    protected context: TransformerContext;

    constructor(context: TransformerContext) {
        this.context = context;
    }

    private anonymousMethodToString(method: ArkMethod, indent: string): string {
        let mtdPrinter = new SourceMethod(method, indent);
        mtdPrinter.setInBuilder(this.context.isInBuilderMethod());
        return mtdPrinter.dump().trimStart();
    }

    private anonymousClassToString(cls: ArkClass, indent: string): string {
        let clsPrinter = new SourceClass(cls, indent);
        return clsPrinter.dump().trimStart();
    }

    public instanceInvokeExprToString(invokeExpr: ArkInstanceInvokeExpr): string {
        let methodName = invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName();
        if (methodName === INSTANCE_INIT_METHOD_NAME) {
            return '';
        }
        let args: string[] = [];
        invokeExpr.getArgs().forEach((v) => {
            args.push(this.valueToString(v));
        });
        let genericCode = this.genericTypesToString(invokeExpr.getRealGenericTypes());

        if (SourceUtils.isComponentAttributeInvoke(invokeExpr) && this.context.isInBuilderMethod()) {
            return `.${methodName}${genericCode}(${args.join(', ')})`;
        }

        return `${this.valueToString(invokeExpr.getBase())}.${methodName}${genericCode}(${args.join(', ')})`;
    }

    public staticInvokeExprToString(invokeExpr: ArkStaticInvokeExpr): string {
        let methodSignature = invokeExpr.getMethodSignature();
        let method = this.context.getMethod(methodSignature);
        if (method && SourceUtils.isAnonymousMethod(method.getName())) {
            return this.anonymousMethodToString(method, this.context.getPrinter().getIndent());
        }

        let classSignature = methodSignature.getDeclaringClassSignature();
        let className = SourceUtils.getStaticInvokeClassFullName(classSignature, this.context.getDeclaringArkNamespace());
        let methodName = methodSignature.getMethodSubSignature().getMethodName();
        let args: string[] = [];
        invokeExpr.getArgs().forEach((v) => {
            args.push(this.valueToString(v));
        });

        let genericCode = this.genericTypesToString(invokeExpr.getRealGenericTypes());

        if (this.context.isInBuilderMethod()) {
            if (className === COMPONENT_CUSTOMVIEW) {
                if (methodName === COMPONENT_CREATE_FUNCTION) {
                    // Anonymous @Builder method
                    if (args.length > 1) {
                        args[1] = args[1].substring('() => '.length);
                    }
                    return `${args.join(' ')}`;
                }
                if (methodName === COMPONENT_POP_FUNCTION) {
                    return '';
                }
            }

            if (SourceUtils.isComponentCreate(invokeExpr)) {
                if (className === COMPONENT_IF) {
                    return `if (${args.join(', ')})`;
                }
                return `${className}${genericCode}(${args.join(', ')})`;
            }

            if (SourceUtils.isComponentIfBranchInvoke(invokeExpr)) {
                let arg0 = invokeExpr.getArg(0) as Constant;
                if (arg0.getValue() === '0') {
                    return ``;
                } else {
                    return '} else {';
                }
            }

            if (SourceUtils.isComponentPop(invokeExpr)) {
                return '}';
            }
        }

        if (className && className.length > 0) {
            return `${className}.${methodName}${genericCode}(${args.join(', ')})`;
        }
        return `${methodName}${genericCode}(${args.join(', ')})`;
    }
    
    private genericTypesToString(types: Type[] | undefined): string {
        if (!types) {
            return '';
        }

        let code = this.typeArrayToString(types);
        if (code.length > 0) {
            return `<${code}>`;
        }
        return '';
    }

    public typeArrayToString(types: Type[], split: string = ', '): string {
        let typesStr: string[] = [];
        types.forEach((t) => {
            typesStr.push(this.typeToString(t));
        });

        return typesStr.join(split);
    }

    public static constToString(value: Constant): string {
        if (value.getType().toString() === 'string') {
            return `'${SourceUtils.escape(value.getValue())}'`;
        } else {
            return value.getValue();
        }
    }

    private exprToString(expr: AbstractExpr): string {
        if (expr instanceof ArkInstanceInvokeExpr) {
            return `${this.instanceInvokeExprToString(expr)}`;
        }

        if (expr instanceof ArkStaticInvokeExpr) {
            return `${this.staticInvokeExprToString(expr)}`;
        }

        if (expr instanceof ArkNewArrayExpr) {
            return `new Array<${this.typeToString(expr.getBaseType())}>(${expr.getSize()})`;
        }

        if (expr instanceof ArkNewExpr) {
            return `new ${this.typeToString(expr.getType())}()`;
        }

        if (expr instanceof ArkDeleteExpr) {
            return `delete ${this.valueToString(expr.getField())}`;
        }

        if (expr instanceof AbstractBinopExpr) {
            let op1: Value = expr.getOp1();
            let op2: Value = expr.getOp2();
            let operator: string = expr.getOperator();

            return `${this.valueToString(op1, operator)} ${operator} ${this.valueToString(op2, operator)}`;
        }

        if (expr instanceof ArkTypeOfExpr) {
            return `typeof(${this.valueToString(expr.getOp())})`;
        }

        if (expr instanceof ArkInstanceOfExpr) {
            return `${this.valueToString(expr.getOp())} instanceof ${this.typeToString(expr.getType())}`;
        }

        if (expr instanceof ArkCastExpr) {
            let baseOp = expr.getOp();
            return `${this.valueToString(baseOp)} as ${this.typeToString(expr.getType())}`;
        }

        if (expr instanceof ArkUnopExpr) {
            return `${expr.getOperator()}${this.valueToString(expr.getOp())}`;
        }

        if (expr instanceof ArkAwaitExpr) {
            return `await ${this.valueToString(expr.getPromise())}`;
        }

        if (expr instanceof ArkYieldExpr) {
            return `yield ${this.valueToString(expr.getYieldValue())}`;
        }

        logger.info(`exprToString ${expr.constructor} not support.`);
        // ArkPhiExpr
        return `${expr}`;
    }

    public refToString(value: AbstractRef): string {
        if (value instanceof ArkInstanceFieldRef) {
            return `${this.valueToString(value.getBase())}.${value.getFieldName()}`;
        }

        if (value instanceof ArkStaticFieldRef) {
            return `${value.getFieldSignature().getBaseName()}.${value.getFieldName()}`;
        }

        if (value instanceof ArkArrayRef) {
            let index = value.getIndex();
            if (
                index instanceof Constant &&
                index.getType() instanceof StringType &&
                SourceUtils.isTemp(index.getValue())
            ) {
                return `${this.valueToString(value.getBase())}[${this.valueToString(new Local(index.getValue()))}]`;
            }
            return `${this.valueToString(value.getBase())}[${this.valueToString(value.getIndex())}]`;
        }

        if (value instanceof ArkThisRef) {
            return 'this';
        }

        // ArkCaughtExceptionRef
        logger.info(`refToString ${value.constructor} not support.`);
        return `${value}`;
    }

    public valueToString(value: Value, operator?: string): string {
        if (value instanceof AbstractExpr) {
            return this.exprToString(value);
        }

        if (value instanceof AbstractRef) {
            return this.refToString(value);
        }

        if (value instanceof Constant) {
            return SourceTransformer.constToString(value);
        }

        if (value instanceof Local) {
            if (SourceUtils.isAnonymousMethod(value.getName())) {
                let methodSignature = (value.getType() as FunctionType).getMethodSignature();
                let anonymousMethod = this.context.getMethod(methodSignature);
                if (anonymousMethod) {
                    return this.anonymousMethodToString(anonymousMethod, this.context.getPrinter().getIndent());
                }
            }
            if (SourceUtils.isAnonymousClass(value.getName())) {
                let clsSignature = (value.getType() as ClassType).getClassSignature();
                let cls = this.context.getClass(clsSignature);
                if (cls) {
                    return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
                }
            }

            if (
                operator === NormalBinaryOperator.Division ||
                operator === NormalBinaryOperator.Multiplication ||
                operator === NormalBinaryOperator.Remainder
            ) {
                if (SourceUtils.isTemp(value.getName())) {
                    let stmt = value.getDeclaringStmt();
                    if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ArkNormalBinopExpr) {
                        return `(${this.context.transTemp2Code(value)})`;
                    }
                }
            }

            return this.context.transTemp2Code(value);
        }

        logger.info(`valueToString ${value.constructor} not support.`);
        return `${value}`;
    }

    public literalObjectToString(type: ClassType): string {
        let name = type.getClassSignature().getClassName();
        if (SourceUtils.isAnonymousClass(name)) {
            let cls = this.context.getClass(type.getClassSignature());
            if (cls) {
                return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
            }
        }
        return name;
    }

    public typeToString(type: Type): string {
        if (type instanceof LiteralType) {
            return this.literalType2string(type);
        }

        if (type instanceof PrimitiveType) {
            return type.getName();
        }

        if (type instanceof UnionType) {
            return this.unionType2string(type);
        }

        if (type instanceof UnknownType) {
            return 'any';
        }

        if (type instanceof VoidType) {
            return 'void';
        }

        if (type instanceof ClassType) {
            return this.classType2string(type);
        }
        if (type instanceof ArrayType) {
            return this.arrayType2string(type);
        }

        if (type instanceof FunctionType) {
            let methodSignature = type.getMethodSignature();
            let method = this.context.getMethod(methodSignature);
            if (method && SourceUtils.isAnonymousMethod(method.getName())) {
                return new SourceMethod(method).toArrowFunctionTypeString();
            }
        }

        if (type instanceof UnclearReferenceType) {
            return this.unclearReferenceType2string(type);
        }

        if (type instanceof GenericType) {
            return type.getName();
        }

        if (!type) {
            return 'any';
        }

        logger.info(`valueToString ${type.constructor} not support.`);
        return type.toString();
    }

    private literalType2string(type: LiteralType): string {
        let literalName = type.getLiteralName();
        if (typeof literalName === 'string' && literalName.endsWith('Keyword')) {
            return literalName.substring(0, literalName.length - 'Keyword'.length).toLowerCase();
        }
        return `${literalName}`;
    }

    private unionType2string(type: UnionType): string {
        let typesStr: string[] = [];
        for (const member of type.getTypes()) {
            typesStr.push(this.typeToString(member));
        }
        return typesStr.join(' | ');
    }

    private arrayType2string(type: ArrayType): string {
        const dimensions: string[] = [];
        for (let i = 0; i < type.getDimension(); i++) {
            dimensions.push('[]');
        }

        let baseType = type.getBaseType();
        if (baseType instanceof UnionType) {
            return `(${this.typeToString(baseType)})${dimensions.join('')}`;
        }
        return `${this.typeToString(baseType)}${dimensions.join('')}`;
    }

    private unclearReferenceType2string(type: UnclearReferenceType): string {
        let genericTypes = type.getGenericTypes();
        if (genericTypes.length > 0) {
            return `${type.getName()}<${genericTypes.join(', ')}>`;
        }
        return type.getName();
    }

    private classType2string(type: ClassType): string {
        let name = type.getClassSignature().getClassName();
        if (SourceUtils.isDefaultClass(name)) {
            return 'any';
        }
        if (SourceUtils.isAnonymousClass(name)) {
            let cls = this.context.getClass(type.getClassSignature());
            if (cls && cls.getCategory() === ClassCategory.TYPE_LITERAL) {
                return this.anonymousClassToString(cls, this.context.getPrinter().getIndent());
            }
            return 'Object';
        }
        let genericTypes = type.getRealGenericTypes();
        if (genericTypes && genericTypes.length > 0) {
            return `${name}<${genericTypes.join(', ')}>`;
        }
        return name;
    }
}
