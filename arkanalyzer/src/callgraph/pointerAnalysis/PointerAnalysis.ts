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

import { Scene } from '../../Scene';
import { Value } from '../../core/base/Value';
import { NodeID } from '../model/BaseGraph';
import path from 'path';
import * as fs from 'fs';
import { CallGraph, CallGraphNode, CallSite, DynCallSite, FuncID } from '../model/CallGraph';
import { AbstractAnalysis } from '../algorithm/AbstractAnalysis';
import { ClassType, Type, UnknownType } from '../../core/base/Type';
import { CallGraphBuilder } from '../model/builder/CallGraphBuilder';
import { Stmt } from '../../core/base/Stmt';
import Logger, { LOG_MODULE_TYPE } from '../../utils/logger';
import { DummyMainCreater } from '../../core/common/DummyMainCreater';
import { PTAStat } from '../common/Statistics';
import { Pag, PagNode, PagEdgeKind, PagEdge, PagLocalNode, PagGlobalThisNode, PagArrayNode } from './Pag';
import { PagBuilder } from './PagBuilder';
import { PointerAnalysisConfig } from './PointerAnalysisConfig';
import { DiffPTData, PtsSet } from './PtsDS';
import { Local } from '../../core/base/Local';

const logger = Logger.getLogger(LOG_MODULE_TYPE.ARKANALYZER, 'PTA');

export class PointerAnalysis extends AbstractAnalysis {
    private pag: Pag;
    private pagBuilder: PagBuilder;
    private ptd: DiffPTData<NodeID, NodeID, PtsSet<NodeID>>;
    private entries!: FuncID[];
    private worklist!: NodeID[];
    // record all updated nodes
    private ptaStat: PTAStat;
    private typeDiffMap!: Map<Value, Set<Type>>;
    private config: PointerAnalysisConfig;

    constructor(p: Pag, cg: CallGraph, s: Scene, config: PointerAnalysisConfig) {
        super(s)
        this.pag = p;
        this.cg = cg;
        this.ptd = new DiffPTData<NodeID, NodeID, PtsSet<NodeID>>(PtsSet);
        this.pagBuilder = new PagBuilder(this.pag, this.cg, s, config.kLimit);
        this.cgBuilder = new CallGraphBuilder(this.cg, s);
        this.ptaStat = new PTAStat(this);
        this.config = config;
    }

    static pointerAnalysisForWholeProject(projectScene: Scene, config?: PointerAnalysisConfig): PointerAnalysis {
        let cg = new CallGraph(projectScene);
        let cgBuilder = new CallGraphBuilder(cg, projectScene);
        cgBuilder.buildDirectCallGraphForScene();
        let pag = new Pag();
        if (!config) {
            config = new PointerAnalysisConfig(1, "out/", false, false);
        }

        const dummyMainCreator = new DummyMainCreater(projectScene);
        dummyMainCreator.createDummyMain();
        const dummyMainMethod = dummyMainCreator.getDummyMain();
        cgBuilder.buildDirectCallGraph([dummyMainMethod]);

        let dummyMainMethodID = cg.getCallGraphNodeByMethod(dummyMainMethod.getSignature()).getID();
        cg.setDummyMainFuncID(dummyMainMethodID);

        let pta = new PointerAnalysis(pag, cg, projectScene, config);
        pta.setEntries([dummyMainMethodID]);
        pta.start();
        return pta;
    }

    protected init() {
        logger.warn(`========== Init Pointer Analysis ==========`);
        // start statistics
        this.ptaStat.startStat();
        // build funcPag with entries
        this.pagBuilder.buildForEntries(this.entries);
        if (this.config.dotDump) {
            this.pag.dump(path.join(this.config.outputDirectory, 'ptaInit_pag.dot'));
            this.cg.dump(path.join(this.config.outputDirectory, 'cg_init.dot'));
        }
    }

    public start() {
        this.init();
        this.solveConstraint();
        this.postProcess();
    }

    private postProcess() {
        this.ptaStat.endStat();
        this.pagBuilder.doStat();
        this.cg.printStat();
        this.pagBuilder.printStat();
        this.ptaStat.printStat();
        if (this.config.dotDump) {
            this.pag.dump(path.join(this.config.outputDirectory, 'ptaEnd_pag.dot'));
            this.cg.dump(path.join(this.config.outputDirectory, 'cgEnd.dot'));
        }

        if (this.config.unhandledFuncDump) {
            this.dumpUnhandledFunctions();
        }
    }

    protected preProcessMethod(funcID: FuncID): CallSite[] {
        // do nothing
        return [];
    }

    public setEntries(fIds: FuncID[]) {
        this.entries = fIds;
    }

    private solveConstraint() {
        this.worklist = [];
        logger.warn(`========== Pointer Analysis Start ==========`);
        this.initWorklist();
        let reanalyzer: boolean = true;

        while (reanalyzer) {
            this.ptaStat.iterTimes++;
            logger.warn(`========== Pointer Analysis Round ${this.ptaStat.iterTimes} ==========`);

            // do pointer transfer
            this.solveWorklist();
            // process dynamic call
            reanalyzer = this.onTheFlyDynamicCallSolve();
            if (this.config.dotDump) {
                this.pag.dump(path.join(this.config.outputDirectory, `pta_pag_itor#${this.ptaStat.iterTimes}.dot`));
            }
        }
    }

    /**
     * get newly added Address Edge, and add them to initial WorkList
     */
    private initWorklist() {
        for (let e of this.pag.getAddrEdges()) {
            this.ptaStat.numProcessedAddr++;

            let { src, dst } = e.getEndPoints();
            this.ptd.addPts(dst, src);
            if (this.pag.getNode(src) instanceof PagGlobalThisNode) {
                // readd globalThis heapObj into workList
                this.ptd.addPts(src, src);
                this.worklist.push(src);
            }

            this.worklist.push(dst);
        }
        this.pag.resetAddrEdges();
    }

    private solveWorklist(): boolean {
        while (this.worklist.length > 0) {
            let node = this.worklist.shift() as NodeID;
            this.processNode(node);
        }

        return true;
    }

    private processNode(nodeId: NodeID): boolean {
        this.handleThis(nodeId);
        this.handleLoadWrite(nodeId);
        this.handleCopy(nodeId);
        this.handlePt(nodeId);

        this.detectTypeDiff(nodeId);
        return true;
    }

    private handleCopy(nodeID: NodeID): boolean {
        let node = this.pag.getNode(nodeID) as PagNode;
        node.getOutgoingCopyEdges()?.forEach(copyEdge => {
            this.propagate(copyEdge);
            this.ptaStat.numProcessedCopy++;
        });

        return true;
    }

    private handleLoadWrite(nodeID: NodeID): boolean {
        let node = this.pag.getNode(nodeID) as PagNode;
        let nodeValue = node.getValue();
        let diffPts = this.ptd.getDiffPts(nodeID);
        if (!diffPts || diffPts.count() === 0) {
            return false;
        }

        // get related field node with current node's value
        let instanceFieldNodeMap = this.pag.getNodesByBaseValue(nodeValue) ?? new Map();
        // get intra procedural field node by exportMap
        let intraProceduralFieldNodeMap = new Map();

        if (nodeValue instanceof Local) {
            this.pagBuilder.getExportVariableMap(nodeValue).forEach((dst) => {
                let temp = this.pag.getNodesByBaseValue(dst) ?? new Map();
                intraProceduralFieldNodeMap = this.mergeInstanceFieldMap(instanceFieldNodeMap, temp);
            })
        }

        instanceFieldNodeMap!.forEach((nodeIDs, cid) => {
            // TODO: check cid
            // cid === -1 will escape the check, mainly for globalThis
            let baseCid = node.getCid();
            if (baseCid !== -1 && cid !== baseCid) {
                return;
            }
            nodeIDs.forEach((nodeID: number) => {
                // get abstract field node
                let fieldNode = this.pag.getNode(nodeID) as PagNode;

                this.handleFieldInEdges(fieldNode, diffPts!);
                this.handleFieldOutEdges(fieldNode, diffPts!);
            })
        })

        // without cid check, because closure and export is under different cid
        intraProceduralFieldNodeMap!.forEach((nodeIDs) => {
            nodeIDs.forEach((nodeID: number) => {
                // get abstract field node
                let fieldNode = this.pag.getNode(nodeID) as PagNode;

                this.handleFieldInEdges(fieldNode, diffPts!);
                this.handleFieldOutEdges(fieldNode, diffPts!);
            })
        })

        return true;
    }

    private handleFieldInEdges(fieldNode: PagNode, diffPts: PtsSet<number>): void {
        fieldNode.getIncomingEdge().forEach((edge) => {
            if (edge.getKind() !== PagEdgeKind.Write) {
                return;
            }
            let srcNode = edge.getSrcNode() as PagNode;
            this.ptaStat.numProcessedWrite++;
            for (let pt of diffPts!) {
                // filter pt
                // clone the real field node with abstract field node
                let dstNode;
                if (fieldNode instanceof PagArrayNode) {
                    dstNode = this.pag.getOrClonePagArrayFieldNode(fieldNode, pt);
                } else {
                    dstNode = this.pag.getOrClonePagFieldNode(fieldNode, pt);
                }
                if (dstNode && this.pag.addPagEdge(srcNode, dstNode!, PagEdgeKind.Copy)) {
                    this.ptaStat.numRealWrite++;

                    if (this.ptd.resetElem(srcNode.getID())) {
                        this.worklist.push(srcNode.getID());
                    }
                }
            }
        });
    }

    private handleFieldOutEdges(fieldNode: PagNode, diffPts: PtsSet<number>): void {
        fieldNode.getOutgoingEdges().forEach((edge) => {
            if (edge.getKind() !== PagEdgeKind.Load) {
                return;
            }
            let dstNode = edge.getDstNode() as PagNode;
            this.ptaStat.numProcessedLoad++;
            for (let pt of diffPts!) {
                let srcNode;
                if (fieldNode instanceof PagArrayNode) {
                    srcNode = this.pag.getOrClonePagArrayFieldNode(fieldNode, pt);
                } else {
                    srcNode = this.pag.getOrClonePagFieldNode(fieldNode, pt);
                }
                if (srcNode && this.pag.addPagEdge(srcNode!, dstNode, PagEdgeKind.Copy)) {
                    this.ptaStat.numRealLoad++;

                    // TODO: if field is used before initialzed, newSrc node has no diff pts
                    if (this.ptd.resetElem(srcNode.getID())) {
                        this.worklist.push(srcNode.getID());
                    }
                }
            }
        });
    }

    /**
     * If current node is a base of a called method, pointer in this node will be transfered into `this` Local in method
     */
    private handleThis(nodeID: NodeID): boolean {
        let node = this.pag.getNode(nodeID) as PagNode;
        node.getOutgoingThisEdges()?.forEach(thisEdge => {
            this.propagate(thisEdge);
            this.ptaStat.numProcessedThis++;
        });

        return true;
    }

    private handlePt(nodeID: NodeID) {
        let realDiff = this.ptd.calculateDiff(nodeID, nodeID);

        if (realDiff.count() !== 0) {
            // record the updated nodes
            this.pagBuilder.addUpdatedNode(nodeID, realDiff);
        }
        this.ptd.flush(nodeID);
        this.pagBuilder.setPtForNode(nodeID, this.ptd.getPropaPts(nodeID));
    }

    private propagate(edge: PagEdge): boolean {
        let changed: boolean = false;
        let { src, dst } = edge.getEndPoints();
        let diffPts = this.ptd.getDiffPts(src);
        if (!diffPts) {
            return changed;
        }
        let realDiffPts = this.ptd.calculateDiff(src, dst);

        for (let pt of realDiffPts) {
            changed = this.ptd.addPts(dst, pt) || changed;
        }

        if (changed) {
            this.worklist.push(dst);
        }

        return changed;
    }

    /**
     * 1. 记录被更新的节点(记录cid, nodeid)
     * 2. ( PAGLocalNode记录callsite(cid, value唯一))，通过1种的nodeID查询Node,拿到Callsite
     * 3. 在addDynamicCall里对传入指针过滤（已处理指针和未处理指针）
     */
    private onTheFlyDynamicCallSolve(): boolean {
        let changed: boolean = false;
        let processedCallSites: Set<DynCallSite> = new Set();
        this.pagBuilder.getUpdatedNodes().forEach((pts, nodeID) => {
            let node = this.pag.getNode(nodeID) as PagNode;

            if (!(node instanceof PagLocalNode)) {
                logger.warn(`node ${nodeID} is not local node, value: ${node.getValue()}`);
                return;
            }

            changed = this.processDynCallSite(node, pts, processedCallSites) || changed;
            changed = this.processUnknownCallSite(node, pts) || changed;
        })
        this.pagBuilder.resetUpdatedNodes();
        let srcNodes = this.pagBuilder.handleUnprocessedCallSites(processedCallSites);
        changed = this.addToReanalyze(srcNodes) || changed;

        changed = this.pagBuilder.handleReachable() || changed;
        this.initWorklist();
        return changed;
    }

    private processDynCallSite(node: PagLocalNode, pts: PtsSet<NodeID>, processedCallSites: Set<DynCallSite>): boolean {
        let changed: boolean = false;
        let dynCallSites = node.getRelatedDynCallSites();

        if (!dynCallSites && !node.isSdkParam()) {
            logger.warn(`node ${node.getID()} has no related dynamic call site`);
            return changed;
        }

        logger.info(`[process dynamic callsite] node ${node.getID()}`);
        dynCallSites.forEach((dynCallsite) => {
            for (let pt of pts) {
                let srcNodes = this.pagBuilder.addDynamicCallEdge(dynCallsite, pt, node.getCid());
                changed = this.addToReanalyze(srcNodes) || changed;
            }
            processedCallSites.add(dynCallsite);
        })

        return changed;
    }

    private processUnknownCallSite(node: PagLocalNode, pts: PtsSet<NodeID>): boolean {
        let changed: boolean = false;
        let unknownCallSites = node.getRelatedUnknownCallSites();

        if (!unknownCallSites) {
            logger.warn(`node ${node.getID()} has no related unknown call site`);
            return changed;
        }

        logger.info(`[process unknown callsite] node ${node.getID()}`);
        unknownCallSites.forEach((unknownCallSite) => {
            for (let pt of pts) {
                let srcNodes = this.pagBuilder.addDynamicCallEdge(unknownCallSite, pt, node.getCid());
                changed = this.addToReanalyze(srcNodes) || changed;
            }
        })

        return changed;
    }

    private addToReanalyze(startNodes: NodeID[]): boolean {
        let flag = false;
        for (let node of startNodes) {
            if (!this.worklist.includes(node) && this.ptd.resetElem(node)) {
                this.worklist.push(node);
                flag = true;
            }
        }
        return flag;
    }

    /**
     * compare interface
     */
    public noAlias(leftValue: Value, rightValue: Value): boolean {
        let leftValueNodes = this.pag.getNodesByValue(leftValue)?.values()!;
        let rightValueNodes = this.pag.getNodesByValue(rightValue)?.values()!;

        let leftValuePts: Set<NodeID> = new Set();
        let rightValuePts: Set<NodeID> = new Set();

        for (let nodeID of leftValueNodes) {
            let node = this.pag.getNode(nodeID) as PagNode;
            for (let pt of node.getPointTo()) {
                leftValuePts.add(pt);
            }
        }

        for (let nodeID of rightValueNodes) {
            let node = this.pag.getNode(nodeID) as PagNode;
            for (let pt of node.getPointTo()) {
                rightValuePts.add(pt);
            }
        }

        if (leftValuePts.size > rightValuePts.size) {
            [leftValuePts, rightValuePts] = [rightValuePts, leftValuePts];
        }

        for (const elem of leftValuePts) {
            if (rightValuePts.has(elem)) {
                return false;
            }
        }

        // no alias
        return true;
    }

    public mayAlias(leftValue: Value, rightValue: Value): boolean {
        return !this.noAlias(leftValue, rightValue);
    }

    public getRelatedNodes(value: Value): Set<Value> {
        let valueNodes = this.pag.getNodesByValue(value);
        let relatedAllNodes: Set<Value> = new Set();
        let workListNodes: NodeID[] = [];
        let processedNodes: Set<NodeID> = new Set();

        if (valueNodes) {
            for (const nodeID of valueNodes.values()) {
                workListNodes.push(nodeID);
            }
        }

        while (workListNodes.length !== 0) {
            let valueNodeID: NodeID = workListNodes.shift()!;
            if (processedNodes.has(valueNodeID)) {
                continue;
            }
    
            this.processRelatedNode(valueNodeID, workListNodes, processedNodes);
        }

        processedNodes.forEach(nodeID => {
            let valueNode = this.pag.getNode(nodeID) as PagNode;
            relatedAllNodes.add(valueNode.getValue());
        })

        return relatedAllNodes;
    }

    private processRelatedNode(valueNodeID: NodeID, workListNodes: NodeID[], processedNodes: Set<NodeID>): void {
        let valueNode = this.pag.getNode(valueNodeID) as PagNode;
    
        this.addIncomingEdgesToWorkList(valueNode, workListNodes, processedNodes);
        this.addOutgoingEdgesToWorkList(valueNode, workListNodes, processedNodes);
    
        processedNodes.add(valueNodeID);
    }

    private addIncomingEdgesToWorkList(valueNode: PagNode, workListNodes: NodeID[], processedNodes: Set<NodeID>): void {
        let inCopyEdges = valueNode.getIncomingCopyEdges();
        if (inCopyEdges) {
            inCopyEdges.forEach(edge => {
                let srcID = edge.getSrcID();
                if (!processedNodes.has(srcID)) {
                    workListNodes.push(srcID);
                }
            });
        }
    }
    
    private addOutgoingEdgesToWorkList(valueNode: PagNode, workListNodes: NodeID[], processedNodes: Set<NodeID>): void {
        let outCopyEdges = valueNode.getOutgoingCopyEdges();
        if (outCopyEdges) {
            outCopyEdges.forEach(edge => {
                let dstID = edge.getDstID();
                if (!processedNodes.has(dstID)) {
                    workListNodes.push(dstID);
                }
            });
        }
    }

    private detectTypeDiff(nodeId: NodeID): void {
        if (this.config.detectTypeDiff === false) {
            return;
        }

        this.typeDiffMap = this.typeDiffMap ?? new Map();
        let node = this.pag.getNode(nodeId) as PagNode;

        let value = node.getValue();
        let origType = node.getValue().getType();
        // TODO: union type
        if (!(origType instanceof ClassType || origType instanceof UnknownType)) {
            return;
        }

        let findSameType = false;
        let pts = node.getPointTo();
        if (pts.size === 0) {
            return;
        }

        pts.forEach(pt => {
            let ptNode = this.pag.getNode(pt) as PagNode;
            let type = ptNode.getValue().getType();
            if (type.toString() !== origType.toString()) {
                let diffSet = this.typeDiffMap.get(value) ?? new Set();
                this.typeDiffMap.set(value, diffSet);
                if (!diffSet.has(type)) {
                    diffSet.add(type);
                }
            } else {
                findSameType = true;
            }
        })

        // If find pts to original type, 
        // need add original type back since it is a correct type
        let diffSet = this.typeDiffMap.get(value);
        if (diffSet && findSameType) {
            diffSet.add(origType);
        }
    }

    public getTypeDiffMap(): Map<Value, Set<Type>> {
        return this.typeDiffMap ?? new Map();
    }

    protected resolveCall(sourceMethod: NodeID, invokeStmt: Stmt): CallSite[] {
        return [];
    }

    public getUnhandledFuncs(): FuncID[] {
        return this.pagBuilder.getUnhandledFuncs();
    }

    public getHandledFuncs(): FuncID[] {
        return this.pagBuilder.getHandledFuncs();
    }

    public getPTAConfig(): PointerAnalysisConfig {
        return this.config;
    }

    private dumpUnhandledFunctions(): void {
        const filePath = path.join(this.config.outputDirectory, 'PtaUnhandledFunctionList.txt');
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (!err) {
                fs.truncate(filePath, 0, (err) => {
                    if (err) {
                        console.log('Error to truncate file ', err);
                    }
                });
            }

            let updatedContent: string = '';
            this.getUnhandledFuncs().forEach(funcID => {
                let cgNode = this.cg.getNode(funcID);
                if ((cgNode as CallGraphNode).isSdkMethod()) {
                    return;
                }

                let f = this.cg.getArkMethodByFuncID(funcID);
                if (f) {
                    updatedContent += f.getSignature().toString() + '\n';
                }
            });

            fs.writeFile(filePath, updatedContent, 'utf8', (err) => {
                if (err) {
                    console.error('Error to write file', err);
                }
            });
        });
    }

    public mergeInstanceFieldMap(src: Map<number, number[]>, dst: Map<number, number[]>): Map<number, number[]> {
        dst.forEach((value, key) => {
            if (src.has(key)) {
              src.set(key, [...src.get(key)!, ...value]);
            } else {
              src.set(key, value);
            }
        });
        return src;
    }
}