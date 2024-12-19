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

import path from 'path';
import { transfer2UnixPath } from '../../utils/pathTransfer';
import { ClassType, Type } from '../base/Type';
import { MethodParameter } from './builder/ArkMethodBuilder';
import { UNKNOWN_CLASS_NAME, UNKNOWN_FILE_NAME, UNKNOWN_NAMESPACE_NAME, UNKNOWN_PROJECT_NAME } from '../common/Const';
import { CryptoUtils } from '../../utils/crypto_utils';

export type Signature =
    FileSignature
    | NamespaceSignature
    | ClassSignature
    | MethodSignature
    | FieldSignature
    | LocalSignature;

export interface ArkSignature {
    getSignature(): Signature;
}

/**
 * @category core/model
 */
export class FileSignature {
    private projectName: string;
    private fileName: string;
    private hashcode: number;

    public static readonly DEFAULT: FileSignature = new FileSignature(UNKNOWN_PROJECT_NAME, UNKNOWN_FILE_NAME);

    constructor(projectName: string, fileName: string) {
        this.projectName = projectName;
        this.fileName = transfer2UnixPath(fileName);
        this.hashcode = CryptoUtils.hashcode(this.toString());
    }

    public getProjectName() {
        return this.projectName;
    }

    public getFileName() {
        return this.fileName;
    }

    public toString(): string {
        return `@${this.projectName}/${this.fileName}: `;
    }

    public toMapKey(): string {
        return `${this.hashcode}${path.basename(this.fileName)}`;
    }
}

export class NamespaceSignature {
    private namespaceName: string;
    private declaringFileSignature: FileSignature;
    private declaringNamespaceSignature: NamespaceSignature | null;

    public static readonly DEFAULT: NamespaceSignature = new NamespaceSignature(UNKNOWN_NAMESPACE_NAME,
        FileSignature.DEFAULT, null);

    constructor(namespaceName: string, declaringFileSignature: FileSignature,
                declaringNamespaceSignature: NamespaceSignature | null = null) {
        this.namespaceName = namespaceName;
        this.declaringFileSignature = declaringFileSignature;
        this.declaringNamespaceSignature = declaringNamespaceSignature;
    }

    public getNamespaceName() {
        return this.namespaceName;
    }

    public getDeclaringFileSignature() {
        return this.declaringFileSignature;
    }

    public getDeclaringNamespaceSignature() {
        return this.declaringNamespaceSignature;
    }

    public toString(): string {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toString() + '.' + this.namespaceName;
        } else {
            return this.declaringFileSignature.toString() + this.namespaceName;
        }
    }

    public toMapKey(): string {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toMapKey() + '.' + this.namespaceName;
        } else {
            return this.declaringFileSignature.toMapKey() + this.namespaceName;
        }
    }
}

export class ClassSignature {
    private declaringFileSignature: FileSignature;
    private declaringNamespaceSignature: NamespaceSignature | null;
    private className: string;

    public static readonly DEFAULT: ClassSignature = new ClassSignature(UNKNOWN_CLASS_NAME, FileSignature.DEFAULT,
        null);

    constructor(className: string, declaringFileSignature: FileSignature,
                declaringNamespaceSignature: NamespaceSignature | null = null) {
        this.className = className;
        this.declaringFileSignature = declaringFileSignature;
        this.declaringNamespaceSignature = declaringNamespaceSignature;
    }

    /**
     * Returns the declaring file signature.
     * @returns The declaring file signature.
     */
    public getDeclaringFileSignature() {
        return this.declaringFileSignature;
    }

    /**
     * Get the declaring namespace's signature.
     * @returns the declaring namespace's signature.
     */
    public getDeclaringNamespaceSignature() {
        return this.declaringNamespaceSignature;
    }

    /**
     * Get the **string** name of class from the the class signature. The default value is `""`.
     * @returns The name of this class.
     */
    public getClassName() {
        return this.className;
    }

    public setClassName(className: string) {
        this.className = className;
    }

    public getType(): ClassType {
        return new ClassType(this);
    }

    public toString(): string {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toString() + '.' + this.className;
        } else {
            return this.declaringFileSignature.toString() + this.className;
        }
    }

    public toMapKey(): string {
        if (this.declaringNamespaceSignature) {
            return this.declaringNamespaceSignature.toMapKey() + '.' + this.className;
        } else {
            return this.declaringFileSignature.toMapKey() + this.className;
        }
    }
}

export type BaseSignature = ClassSignature | NamespaceSignature;

export class FieldSignature {
    private declaringSignature: BaseSignature;
    private fieldName: string;
    private type: Type;
    private staticFlag: boolean;

    constructor(fieldName: string, declaringSignature: BaseSignature, type: Type, staticFlag: boolean = false) {
        this.fieldName = fieldName;
        this.declaringSignature = declaringSignature;
        this.type = type;
        this.staticFlag = staticFlag;
    }

    public getDeclaringSignature() {
        return this.declaringSignature;
    }

    public getBaseName() {
        return this.declaringSignature instanceof ClassSignature ? this.declaringSignature.getClassName()
            : this.declaringSignature.getNamespaceName();
    }

    public getFieldName() {
        return this.fieldName;
    }

    public getType(): Type {
        return this.type;
    }

    public isStatic(): boolean {
        return this.staticFlag;
    }

    // temp for being compatible with existing type inference
    public setType(type: Type): void {
        this.type = type;
    }

    // temp for being compatible with existing type inference
    public setStaticFlag(flag: boolean): void {
        this.staticFlag = flag;
    }

    public toString(): string {
        let tmpSig = this.fieldName;
        if (this.isStatic()) {
            tmpSig = '[static]' + tmpSig;
        }
        return this.getDeclaringSignature().toString() + '.' + tmpSig;
    }
}

export class MethodSubSignature {
    private methodName: string;
    private parameters: MethodParameter[];
    private returnType: Type;
    private staticFlag: boolean;

    constructor(methodName: string, parameters: MethodParameter[], returnType: Type, staticFlag: boolean = false) {
        this.methodName = methodName;
        this.parameters = parameters;
        this.returnType = returnType;
        this.staticFlag = staticFlag;
    }

    public getMethodName() {
        return this.methodName;
    }

    public getParameters() {
        return this.parameters;
    }

    public getParameterTypes(): Type[] {
        const parameterTypes: Type[] = [];
        this.parameters.forEach((parameter) => {
            parameterTypes.push(parameter.getType());
        });
        return parameterTypes;
    }

    public getReturnType(): Type {
        return this.returnType;
    }

    public setReturnType(returnType: Type): void {
        this.returnType = returnType;
    }

    public isStatic(): boolean {
        return this.staticFlag;
    }

    public toString(): string {
        let paraStr = "";
        this.getParameterTypes().forEach((parameterType) => {
            paraStr += parameterType.toString() + ", ";
        });
        paraStr = paraStr.replace(/, $/, '');
        let tmpSig = `${this.getMethodName()}(${paraStr})`;
        if (this.isStatic()) {
            tmpSig = '[static]' + tmpSig;
        }
        return tmpSig;
    }
}

/**
 * @category core/model
 */
export class MethodSignature {
    private declaringClassSignature: ClassSignature;
    private methodSubSignature: MethodSubSignature;

    constructor(declaringClassSignature: ClassSignature, methodSubSignature: MethodSubSignature) {
        this.declaringClassSignature = declaringClassSignature;
        this.methodSubSignature = methodSubSignature;
    }

    /**
     * Return the declaring class signature.
     * A {@link ClassSignature} includes:
     * - File Signature: including the **string** names of the project and file, respectively. The default value of project's name is "%unk" and the default value of file's name is "%unk".
     * - Namespace Signature | **null**:  it may be a namespace signature or **null**. A namespace signature can indicate its **string** name of namespace and its file signature.
     * - Class Name: the **string** name of this class.
     * @returns The declaring class signature.
     * @example
     * 1. get class signature from ArkMethod.

     ```typescript
     let methodSignature = expr.getMethodSignature();
     let name = methodSignature.getDeclaringClassSignature().getClassName();
     ```
     *
     */
    public getDeclaringClassSignature() {
        return this.declaringClassSignature;
    }

    /**
     * Returns the sub-signature of this method signature.
     * The sub-signature is part of the method signature, which is used to
     * identify the name of the method, its parameters and the return value type.
     * @returns The sub-signature of this method signature.
     */
    public getMethodSubSignature() {
        return this.methodSubSignature;
    }

    public getType(): Type {
        return this.methodSubSignature.getReturnType();
    }

    public toString(): string {
        return this.declaringClassSignature.toString() + '.' + this.methodSubSignature.toString();
    }

    public toMapKey(): string {
        return this.declaringClassSignature.toMapKey() + '.' + this.methodSubSignature.toString();
    }

    public isMatch(signature: MethodSignature): boolean {
        return ((this.toString() === signature.toString()) && (this.getType().toString() === signature.getType().toString()));
    }
}

export class LocalSignature {
    private name: string;
    private declaringMethodSignature: MethodSignature;

    constructor(name: string, declaringMethodSignature: MethodSignature) {
        this.name = name;
        this.declaringMethodSignature = declaringMethodSignature;
    }

    public getName(): string {
        return this.name;
    }

    public getDeclaringMethodSubSignature() {
        return this.declaringMethodSignature;
    }

    public toString(): string {
        return this.declaringMethodSignature.toString() + '#' + this.name;
    }
}

//TODO, reconstruct
export function fieldSignatureCompare(leftSig: FieldSignature, rightSig: FieldSignature): boolean {
    if (leftSig.getDeclaringSignature().toString() === rightSig.getDeclaringSignature().toString() &&
        (leftSig.getFieldName() === rightSig.getFieldName())) {
        return true;
    }
    return false;
}

export function methodSignatureCompare(leftSig: MethodSignature, rightSig: MethodSignature): boolean {
    if (classSignatureCompare(leftSig.getDeclaringClassSignature(), rightSig.getDeclaringClassSignature()) &&
        methodSubSignatureCompare(leftSig.getMethodSubSignature(), rightSig.getMethodSubSignature())) {
        return true;
    }
    return false;
}

export function methodSubSignatureCompare(leftSig: MethodSubSignature, rightSig: MethodSubSignature): boolean {
    if ((leftSig.getMethodName() === rightSig.getMethodName()) && arrayCompare(leftSig.getParameterTypes(),
        rightSig.getParameterTypes()) && leftSig.getReturnType() === rightSig.getReturnType()) {
        return true;
    }
    return false;
}

export function classSignatureCompare(leftSig: ClassSignature, rightSig: ClassSignature): boolean {
    if ((fileSignatureCompare(leftSig.getDeclaringFileSignature(), rightSig.getDeclaringFileSignature())) &&
        (leftSig.getClassName() === rightSig.getClassName())) {
        return true;
    }
    return false;
}

export function fileSignatureCompare(leftSig: FileSignature, rightSig: FileSignature): boolean {
    if ((leftSig.getFileName() === rightSig.getFileName()) && (leftSig.getProjectName() === rightSig.getProjectName())) {
        return true;
    }
    return false;
}

function arrayCompare(leftArray: any[], rightArray: any[]) {
    if (leftArray.length !== rightArray.length) {
        return false;
    }
    for (let i = 0; i < leftArray.length; i++) {
        if (leftArray[i] !== rightArray[i]) {
            return false;
        }
    }
    return true;
}

export function genSignature4ImportClause(arkFileName: string, importClauseName: string): string {
    return `<${arkFileName}>.<${importClauseName}>`;
}