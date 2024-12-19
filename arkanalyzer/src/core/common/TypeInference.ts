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

import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { AbstractExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from '../base/Expr';
import { Local } from '../base/Local';
import {
    AbstractFieldRef,
    AbstractRef,
    ArkArrayRef,
    ArkInstanceFieldRef,
    ArkParameterRef,
    ArkStaticFieldRef,
} from '../base/Ref';
import { ArkAssignStmt, ArkInvokeStmt, Stmt } from '../base/Stmt';
import {
    AliasType,
    AnnotationNamespaceType,
    AnyType,
    ArrayType,
    BooleanType,
    ClassType,
    FunctionType,
    GenericType,
    NeverType,
    NullType,
    NumberType,
    StringType,
    Type,
    UnclearReferenceType,
    UndefinedType,
    UnionType,
    UnknownType,
    VoidType,
} from '../base/Type';
import { ArkMethod } from '../model/ArkMethod';
import { ArkExport } from '../model/ArkExport';
import { ArkClass } from '../model/ArkClass';
import { ArkField } from '../model/ArkField';
import { Value } from '../base/Value';
import { Constant } from '../base/Constant';
import { ArkNamespace } from '../model/ArkNamespace';
import { CONSTRUCTOR_NAME, SUPER_NAME } from './TSConst';
import { ModelUtils } from './ModelUtils';
import { Builtin } from './Builtin';
import { ClassSignature, MethodSignature, MethodSubSignature } from '../model/ArkSignature';
import { ANONYMOUS_CLASS_PREFIX, INSTANCE_INIT_METHOD_NAME, UNKNOWN_FILE_NAME } from './Const';
import { EMPTY_STRING } from './ValueUtil';
import { Scene } from '../../Scene';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'TypeInference');


export class TypeInference {

    public static inferTypeInArkField(arkField: ArkField): void {
        const arkClass = arkField.getDeclaringArkClass();
        const stmts = arkField.getInitializer();
        let rightType: Type | undefined;
        let fieldRef: AbstractFieldRef | undefined;
        const method = arkClass.getMethodWithName(INSTANCE_INIT_METHOD_NAME);
        for (const stmt of stmts) {
            if (method) {
                this.resolveExprsInStmt(stmt, method);
                this.resolveFieldRefsInStmt(stmt, method);
            }
            this.resolveArkAssignStmt(stmt, arkClass);
        }
        const beforeType = arkField.getType();
        if (!this.isUnclearType(beforeType)) {
            return;
        }
        const lastStmt = stmts[stmts.length - 1];
        if (lastStmt instanceof ArkAssignStmt) {
            rightType = lastStmt.getRightOp().getType();
            if (lastStmt.getLeftOp() instanceof AbstractFieldRef) {
                fieldRef = lastStmt.getLeftOp() as AbstractFieldRef;
            }
        }
        let fieldType;
        if (beforeType) {
            fieldType = this.inferUnclearedType(beforeType, arkClass, rightType);
        }
        if (fieldType) {
            arkField.getSignature().setType(fieldType);
            fieldRef?.setFieldSignature(arkField.getSignature());
        } else if (rightType && this.isUnclearType(beforeType) && !this.isUnclearType(rightType)) {
            arkField.getSignature().setType(rightType);
            fieldRef?.setFieldSignature(arkField.getSignature());
        }
    }

    public static inferUnclearedType(leftOpType: Type, declaringArkClass: ArkClass, rightType?: Type) {
        let type;
        if (leftOpType instanceof UnclearReferenceType) {
            type = this.inferUnclearRefType(leftOpType, declaringArkClass);
        } else if (leftOpType instanceof ClassType
            && leftOpType.getClassSignature().getDeclaringFileSignature().getFileName() === UNKNOWN_FILE_NAME) {
            type = TypeInference.inferUnclearReferenceType(leftOpType.getClassSignature().getClassName(), declaringArkClass);
        } else if (leftOpType instanceof UnionType) {
            let types = leftOpType.getTypes();
            for (let i = 0; i < types.length; i++) {
                let optionType = types[i];
                let newType;
                if (optionType instanceof ClassType) {
                    newType = TypeInference.inferUnclearReferenceType(optionType.getClassSignature().getClassName(), declaringArkClass);
                } else if (optionType instanceof UnclearReferenceType) {
                    newType = TypeInference.inferUnclearReferenceType(optionType.getName(), declaringArkClass);
                } else {
                    newType = optionType;
                }
                if (newType) {
                    types[i] = newType;
                }
                if (rightType && newType && newType.constructor === rightType.constructor) {
                    leftOpType.setCurrType(rightType);
                    type = leftOpType;
                }
            }
        } else if (leftOpType instanceof ArrayType) {
            let baseType = this.inferUnclearedType(leftOpType.getBaseType(), declaringArkClass);
            if (baseType) {
                leftOpType.setBaseType(baseType);
                type = leftOpType;
            }
        } else if (leftOpType instanceof AliasType) {
            let baseType = this.inferUnclearedType(leftOpType.getOriginalType(), declaringArkClass);
            if (baseType) {
                leftOpType.setOriginalType(baseType);
                type = leftOpType;
            }
        } else if (leftOpType instanceof AnnotationNamespaceType) {
            type = this.inferUnclearReferenceType(leftOpType.getOriginType(), declaringArkClass);
        }
        return type;
    }

    public static inferTypeInMethod(arkMethod: ArkMethod): void {
        const arkClass = arkMethod.getDeclaringArkClass();
        this.inferGenericType(arkMethod.getGenericTypes(), arkClass);
        const signatures: MethodSignature[] = [];
        arkMethod.getDeclareSignatures()?.forEach(m => signatures.push(m));
        const impl = arkMethod.getImplementationSignature();
        if (impl) {
            signatures.push(impl);
        }
        signatures.forEach(s => {
            s.getMethodSubSignature().getParameters().forEach(p => {
                const type = TypeInference.inferUnclearedType(p.getType(), arkClass);
                if (type) {
                    p.setType(type);
                }
            });
            const type = TypeInference.inferUnclearedType(s.getMethodSubSignature().getReturnType(), arkClass);
            if (type) {
                s.getMethodSubSignature().setReturnType(type);
            }
        });
        const body = arkMethod.getBody();
        if (!body) {
            logger.warn('empty body');
            return;
        }
        body.getAliasTypeMap()?.forEach((value) => this.inferUnclearedType(value[0], arkClass));
        this.inferGenericType(arkMethod.getGenericTypes(), arkClass);
        const cfg = body.getCfg();
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                this.resolveExprsInStmt(stmt, arkMethod);
                this.resolveFieldRefsInStmt(stmt, arkMethod);
                this.resolveArkAssignStmt(stmt, arkClass);
            }
        }
    }

    /**
     * @Deprecated
     * @param arkMethod
     */
    public static inferSimpleTypeInMethod(arkMethod: ArkMethod): void {
        const body = arkMethod.getBody();
        if (!body) {
            logger.warn('empty body');
            return;
        }
        const cfg = body.getCfg();
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                TypeInference.inferSimpleTypeInStmt(stmt);
            }
        }
    }

    /**
     * infer type for Exprs in stmt which invoke method.
     * such as ArkInstanceInvokeExpr ArkStaticInvokeExpr ArkNewExpr
     */
    private static resolveExprsInStmt(stmt: Stmt, arkMethod: ArkMethod): void {
        const exprs = stmt.getExprs();
        for (const expr of exprs) {
            const newExpr = expr.inferType(arkMethod);
            if (stmt.containsInvokeExpr() && expr instanceof ArkInstanceInvokeExpr && newExpr instanceof ArkStaticInvokeExpr) {
                if (stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ArkInstanceInvokeExpr) {
                    stmt.setRightOp(newExpr);
                } else if (stmt instanceof ArkInvokeStmt) {
                    stmt.replaceInvokeExpr(newExpr);
                }
            }
        }
    }

    /**
     * infer type for fieldRefs in stmt.
     */
    private static resolveFieldRefsInStmt(stmt: Stmt, arkMethod: ArkMethod): void {
        for (const use of stmt.getUses()) {
            if (use instanceof AbstractRef) {
                this.processRef(use, stmt, arkMethod);
            }
        }
        const stmtDef = stmt.getDef();
        if (stmtDef && stmtDef instanceof AbstractRef) {
            const fieldRef = stmtDef.inferType(arkMethod);
            if (fieldRef instanceof ArkStaticFieldRef && stmt instanceof ArkAssignStmt) {
                stmt.setLeftOp(fieldRef);
            }
        }
    }

    private static processRef(use: AbstractRef | ArkInstanceFieldRef, stmt: Stmt, arkMethod: ArkMethod): void {
        const fieldRef = use.inferType(arkMethod);
        if (fieldRef instanceof ArkStaticFieldRef && stmt instanceof ArkAssignStmt) {
            if (stmt.getRightOp() instanceof ArkInstanceFieldRef) {
                stmt.setRightOp(fieldRef);
            } else {
                stmt.replaceUse(use, fieldRef);
                stmt.setRightOp(stmt.getRightOp());
            }
        } else if (use instanceof ArkInstanceFieldRef && fieldRef instanceof ArkArrayRef && stmt instanceof ArkAssignStmt) {
            const index = fieldRef.getIndex();
            if (index instanceof Constant && index.getType() instanceof StringType) {
                const local = arkMethod?.getBody()?.getLocals().get(index.getValue());
                if (local) {
                    fieldRef.setIndex(local);
                }
            }
            stmt.replaceUse(use, fieldRef);
            stmt.setRightOp(stmt.getRightOp());
        }
    }

    public static parseArkExport2Type(arkExport: ArkExport | undefined | null): Type | null {
        if (!arkExport) {
            return null;
        }
        if (arkExport instanceof ArkClass) {
            return new ClassType(arkExport.getSignature(), arkExport.getGenericsTypes());
        } else if (arkExport instanceof ArkNamespace) {
            let namespaceType = new AnnotationNamespaceType(arkExport.getName());
            namespaceType.setNamespaceSignature(arkExport.getSignature());
            return namespaceType;
        } else if (arkExport instanceof ArkMethod) {
            return new FunctionType(arkExport.getSignature());
        } else if (arkExport instanceof Local) {
            if (arkExport.getType() instanceof UnknownType || arkExport.getType() instanceof UnclearReferenceType) {
                return null;
            }
            return arkExport.getType();
        } else if (arkExport instanceof AliasType) {
            return arkExport;
        } else {
            return null;
        }
    }

    /**
     * infer and pass type for ArkAssignStmt right and left
     * @param stmt
     * @param arkClass
     */
    public static resolveArkAssignStmt(stmt: Stmt, arkClass: ArkClass): void {
        if (!(stmt instanceof ArkAssignStmt)) {
            return;
        }
        const rightOp = stmt.getRightOp();
        if (rightOp instanceof Local && rightOp.getType() instanceof UnknownType) {
            const type = this.inferUnclearReferenceType(rightOp.getName(), arkClass);
            if (type) {
                rightOp.setType(type);
            }
        } else if (rightOp.getType() instanceof UnclearReferenceType) {
            const type = this.inferUnclearReferenceType((rightOp.getType() as UnclearReferenceType).getName(), arkClass);
            if (type && rightOp instanceof ArkParameterRef) {
                rightOp.setType(type);
            }
        }
        const leftOp = stmt.getLeftOp();
        let type: Type | null | undefined = leftOp.getType();
        if (this.isUnclearType(type)) {
            type = this.inferUnclearedType(type, arkClass, rightOp.getType());
        }
        if (type instanceof UnionType &&
            !this.isUnclearType(rightOp.getType()) && !(leftOp instanceof ArkArrayRef)) {
            const cur = type.getTypes().find(t => rightOp.getType().constructor === t.constructor);
            if (cur) {
                type.setCurrType(cur);
            }
        }
        if (this.isUnclearType(type) && !this.isUnclearType(rightOp.getType())) {
            type = rightOp.getType();
        }
        if (type && leftOp instanceof Local) {
            leftOp.setType(type);
        } else if (type && leftOp instanceof AbstractFieldRef) {
            leftOp.getFieldSignature().setType(type);
        }

    }

    public static isUnclearType(type: Type | null | undefined) {
        if (!type || type instanceof UnknownType || type instanceof UnclearReferenceType) {
            return true;
        } else if (type instanceof ClassType
            && type.getClassSignature().getDeclaringFileSignature().getFileName() === UNKNOWN_FILE_NAME) {
            return true;
        } else if (type instanceof UnionType) {
            return !!type.getTypes().find(t => t instanceof UnclearReferenceType);
        } else if (type instanceof ArrayType) {
            return (type.getBaseType() instanceof UnclearReferenceType);
        } else if (type instanceof AliasType) {
            return (type.getOriginalType() instanceof UnclearReferenceType);
        }
        return false;
    }

    public static inferSimpleTypeInStmt(stmt: Stmt): void {
        if (stmt instanceof ArkAssignStmt) {
            const leftOp = stmt.getLeftOp();
            if (leftOp instanceof Local) {
                const leftOpType = leftOp.getType();
                if (leftOpType instanceof UnknownType) {
                    const rightOp = stmt.getRightOp();
                    leftOp.setType(rightOp.getType());
                }
            }
        }
    }

    // Deal only with simple situations
    public static buildTypeFromStr(typeStr: string): Type {
        switch (typeStr) {
            case 'boolean':
                return BooleanType.getInstance();
            case 'number':
                return NumberType.getInstance();
            case 'string':
                return StringType.getInstance();
            case 'undefined':
                return UndefinedType.getInstance();
            case 'null':
                return NullType.getInstance();
            case 'any':
                return AnyType.getInstance();
            case 'void':
                return VoidType.getInstance();
            case 'never':
                return NeverType.getInstance();
            case 'RegularExpression': {
                const classSignature = Builtin.REGEXP_CLASS_SIGNATURE;
                return new ClassType(classSignature);
            }
            default:
                return new UnclearReferenceType(typeStr);
        }
    }

    public static inferValueType(value: Value, arkMethod: ArkMethod): Type | null {
        if (value instanceof ArkInstanceFieldRef || value instanceof ArkInstanceInvokeExpr) {
            this.inferValueType(value.getBase(), arkMethod);
        }
        if (value instanceof AbstractRef || value instanceof AbstractExpr || value instanceof Local) {
            value.inferType(arkMethod);
        }
        return value.getType();
    }

    public static inferMethodReturnType(method: ArkMethod): void {
        if (method.getName() === CONSTRUCTOR_NAME) {
            const oldMethodSignature = method.getSignature();
            const oldMethodSubSignature = oldMethodSignature.getMethodSubSignature();
            const newReturnType = new ClassType(method.getDeclaringArkClass().getSignature());
            const newMethodSubSignature = new MethodSubSignature(
                oldMethodSubSignature.getMethodName(),
                oldMethodSubSignature.getParameters(),
                newReturnType,
                oldMethodSubSignature.isStatic()
            );
            method.setImplementationSignature(new MethodSignature(oldMethodSignature.getDeclaringClassSignature(), newMethodSubSignature));
            return;
        }

        let implSignature = method.getImplementationSignature();
        if (implSignature !== null) {
            const newSignature = this.inferSignatureReturnType(implSignature, method.getDeclaringArkClass());
            if (newSignature !== null) {
                method.setImplementationSignature(newSignature);
            }
        }

        let declareSignatures = method.getDeclareSignatures();
        declareSignatures?.forEach((signature, index) => {
            const newSignature = this.inferSignatureReturnType(signature, method.getDeclaringArkClass());
            if (newSignature !== null) {
                method.setDeclareSignatureWithIndex(newSignature, index);
            }
        });
    }

    private static inferSignatureReturnType(oldSignature: MethodSignature, declaringClass: ArkClass): MethodSignature | null {
        const currReturnType = oldSignature.getType();
        if (currReturnType instanceof UnclearReferenceType) {
            const newReturnType = this.inferUnclearReferenceType(currReturnType.getName(), declaringClass);
            if (newReturnType !== null) {
                const oldSubSignature = oldSignature.getMethodSubSignature();
                const newMethodSubSignature = new MethodSubSignature(
                    oldSubSignature.getMethodName(),
                    oldSubSignature.getParameters(),
                    newReturnType,
                    oldSubSignature.isStatic()
                );
                return new MethodSignature(oldSignature.getDeclaringClassSignature(), newMethodSubSignature);
            }
        }
        return null;
    }

    public static inferGenericType(types: GenericType[] | undefined, arkClass: ArkClass) {
        types?.forEach(type => {
            const defaultType = type.getDefaultType();
            if (defaultType instanceof UnclearReferenceType) {
                const newDefaultType = TypeInference.inferUnclearReferenceType(defaultType.getName(), arkClass);
                if (newDefaultType) {
                    type.setDefaultType(newDefaultType);
                }
            }
            const constraint = type.getConstraint();
            if (constraint instanceof UnclearReferenceType) {
                const newConstraint = TypeInference.inferUnclearReferenceType(constraint.getName(), arkClass);
                if (newConstraint) {
                    type.setConstraint(newConstraint);
                }
            }
        });
    }

    public static inferUnclearRefType(urType: UnclearReferenceType, arkClass: ArkClass): Type | null {
        const realTypes = urType.getGenericTypes();
        this.inferRealGenericTypes(realTypes, arkClass);
        if (urType.getName() === Builtin.ARRAY) {
            return new ArrayType(realTypes[0] ?? AnyType, 1);
        }
        const type = this.inferUnclearReferenceType(urType.getName(), arkClass);
        if (realTypes.length === 0) {
            return type;
        }
        if (type instanceof ClassType) {
            return new ClassType(type.getClassSignature(), realTypes);
        } else if (type instanceof FunctionType) {
            return new FunctionType(type.getMethodSignature(), realTypes);
        } else {
            return new UnclearReferenceType(urType.getName(), realTypes);
        }
    }

    public static inferUnclearReferenceType(refName: string, arkClass: ArkClass): Type | null {
        if (!refName) {
            return null;
        }
        //split and iterate to infer each type
        const singleNames = refName.split('.');
        let type = null;
        for (let i = 0; i < singleNames.length; i++) {
            let genericName: string = EMPTY_STRING;
            const name = singleNames[i].replace(/<(\w+)>/, (match, group1) => {
                genericName = group1;
                return EMPTY_STRING;
            });
            if (i === 0) {
                type = this.inferBaseType(name, arkClass);
            } else if (type) {
                type = this.inferFieldType(type, name, arkClass)?.[1];
            }
            if (!type) {
                return null;
            }
            if (genericName) {
                const realTypes = genericName.split(',').map(generic => {
                    const realType = this.inferBaseType(generic, arkClass);
                    return realType ?? new UnclearReferenceType(generic);
                });
                if (type instanceof ClassType) {
                    type = new ClassType(type.getClassSignature(), realTypes);
                } else if (type instanceof FunctionType) {
                    type = new FunctionType(type.getMethodSignature(), realTypes);
                }
            }
        }
        return type;
    }

    public static inferFieldType(baseType: Type, fieldName: string, declareClass: ArkClass): [any, Type] | null {
        if (baseType instanceof AliasType) {
            baseType = baseType.getOriginalType();
        } else if (baseType instanceof UnionType && baseType.getCurrType()) {
            baseType = baseType.getCurrType();
        }
        let propertyAndType: [any, Type] | null = null;
        if (baseType instanceof ClassType) {
            const arkClass = declareClass.getDeclaringArkFile().getScene().getClass(baseType.getClassSignature());
            if (!arkClass) {
                if (fieldName === Builtin.ITERATOR_RESULT_VALUE && baseType.getClassSignature()
                    .getDeclaringFileSignature().getProjectName() === Builtin.DUMMY_PROJECT_NAME) {
                    const types = baseType.getRealGenericTypes();
                    if (types && types.length > 0) {
                        propertyAndType = [null, types[0]];
                    }
                }
                return propertyAndType;
            }
            if (arkClass.isAnonymousClass()) {
                const fieldType = this.inferUnclearReferenceType(fieldName, arkClass);
                return fieldType ? [null, fieldType] : null;
            }
            const property = ModelUtils.findPropertyInClass(fieldName, arkClass);
            let propertyType: Type | null = null;
            if (property instanceof ArkField) {
                propertyType = property.getType();
            } else if (property) {
                propertyType = this.parseArkExport2Type(property);
            }
            if (propertyType) {
                propertyAndType = [property, propertyType];
            }
        } else if (baseType instanceof AnnotationNamespaceType) {
            const namespace = declareClass.getDeclaringArkFile().getScene().getNamespace(baseType.getNamespaceSignature());
            if (namespace) {
                const property = ModelUtils.findPropertyInNamespace(fieldName, namespace);
                const propertyType = this.parseArkExport2Type(property);
                if (propertyType) {
                    propertyAndType = [property, propertyType];
                }
            }
        } else {
            logger.warn('infer unclear reference type fail: ' + fieldName);
        }
        return propertyAndType;
    }

    public static inferBaseType(baseName: string, arkClass: ArkClass): Type | null {
        if (SUPER_NAME === baseName) {
            return this.parseArkExport2Type(arkClass.getSuperClass());
        }
        const field = arkClass.getDeclaringArkFile().getDefaultClass().getDefaultArkMethod()
            ?.getBody()?.getLocals()?.get(baseName);
        if (field && !this.isUnclearType(field.getType())) {
            return field.getType();
        }
        let arkExport: ArkExport | null = ModelUtils.getClassWithName(baseName, arkClass)
            ?? ModelUtils.getNamespaceWithName(baseName, arkClass)
            ?? ModelUtils.getDefaultClass(arkClass)?.getMethodWithName(baseName)
            ?? ModelUtils.getDefaultClass(arkClass)?.getDefaultArkMethod()?.getBody()?.getAliasTypeByName(baseName)
            ?? ModelUtils.getArkExportInImportInfoWithName(baseName, arkClass.getDeclaringArkFile());
        if (!arkExport && !arkClass.getDeclaringArkFile().getImportInfoBy(baseName)) {
            arkExport = arkClass.getDeclaringArkFile().getScene().getSdkGlobal(baseName);
        }
        return this.parseArkExport2Type(arkExport);
    }

    public static inferRealGenericTypes(realTypes: Type[] | undefined, arkClass: ArkClass): void {
        if (!realTypes) {
            return;
        }
        for (let i = 0; i < realTypes.length; i++) {
            const mayType = realTypes[i];
            if (this.isUnclearType(mayType)) {
                const newType = this.inferUnclearedType(mayType, arkClass);
                if (newType) {
                    realTypes[i] = newType;
                }
            }
        }
    }

    public static inferAnonymousClass(anon: ArkClass | null, declaredSignature: ClassSignature, set: Set<string> = new Set()): void {
        if (!anon) {
            return;
        }
        const key = anon.getSignature().toString();
        if (set.has(key)) {
            return;
        } else {
            set.add(key);
        }
        const scene = anon.getDeclaringArkFile().getScene();
        const declaredClass = scene.getClass(declaredSignature);
        if (!declaredClass) {
            return;
        }
        for (const anonField of anon.getFields()) {
            const property = ModelUtils.findPropertyInClass(anon.getName(), declaredClass);
            if (property instanceof ArkField) {
                TypeInference.assignAnonField(property, anonField, scene, set);
            }
        }
        for (const anonMethod of anon.getMethods()) {
            const methodSignature = declaredClass.getMethodWithName(anonMethod.getName())
                ?.matchMethodSignature(anonMethod.getSubSignature().getParameterTypes());
            if (methodSignature) {
                anonMethod.setImplementationSignature(methodSignature);
            }
        }
    }


    private static assignAnonField(property: ArkField, anonField: ArkField, scene: Scene, set: Set<string>): void {
        function deepInfer(anonType: Type, declaredSignature: ClassSignature): void {
            if (anonType instanceof ClassType && anonType.getClassSignature().getClassName().startsWith(ANONYMOUS_CLASS_PREFIX)) {
                TypeInference.inferAnonymousClass(scene.getClass(anonType.getClassSignature()), declaredSignature, set);
            }
        }

        const type = property.getSignature().getType();
        const lastStmt = anonField.getInitializer().at(-1);
        if (lastStmt instanceof ArkAssignStmt) {
            const rightType = lastStmt.getRightOp().getType();
            if (type instanceof ClassType) {
                deepInfer(rightType, type.getClassSignature());
            } else if (type instanceof ArrayType && type.getBaseType() instanceof ClassType &&
                rightType instanceof ArrayType) {
                const baseType = rightType.getBaseType();
                const classSignature = (type.getBaseType() as ClassType).getClassSignature();
                if (baseType instanceof UnionType) {
                    baseType.getTypes().forEach(t => deepInfer(t, classSignature));
                } else {
                    deepInfer(rightType, classSignature);
                }
            }
            const leftOp = lastStmt.getLeftOp();
            if (leftOp instanceof AbstractFieldRef) {
                leftOp.setFieldSignature(property.getSignature());
            }
        }
        anonField.setSignature(property.getSignature());
    }
}