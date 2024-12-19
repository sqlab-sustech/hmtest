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

import { ArkIfStmt, ArkReturnStmt } from '../core/base/Stmt';
import { BasicBlock } from '../core/graph/BasicBlock';
import { Cfg } from '../core/graph/Cfg';

export enum CodeBlockType {
    NORMAL,
    IF,
    ELSE,
    BREAK,
    CONTINUE,
    DO,
    DO_WHILE,
    WHILE,
    FOR,
    COMPOUND_END,
}

export type TraversalCallback = (block: BasicBlock | undefined, type: CodeBlockType) => void;

export class AbstractFlowGraph {
    private nodes: AbstractNode[] = [];
    private entry: AbstractNode;
    private block2NodeMap: Map<BasicBlock, AbstractNode>;
    private structOf: Map<AbstractNode, Region> = new Map();
    private structTypes: Map<Region, RegionType> = new Map();
    private structBlocks: Map<AbstractNode, Set<AbstractNode>> = new Map();
    private loopMap: Map<AbstractNode, NaturalLoopRegion> = new Map();

    constructor(cfg: Cfg) {
        this.block2NodeMap = new Map<BasicBlock, AbstractNode>();
        for (const bb of cfg.getBlocks()) {
            let an = new AbstractNode();
            an.setBlock(bb);
            this.block2NodeMap.set(bb, an);
        }

        for (const bb of cfg.getBlocks()) {
            let an = this.block2NodeMap.get(bb)!;
            for (const succ of bb.getSuccessors()) {
                an.addSucc(this.block2NodeMap.get(succ)!);
            }
            for (const pred of bb.getPredecessors()) {
                an.addPred(this.block2NodeMap.get(pred)!);
            }
        }

        this.entry = this.block2NodeMap.get(cfg.getStartingBlock()!)!;
        this.structuralAnalysis();
    }

    public getEntry(): AbstractNode {
        return this.entry;
    }

    public getForIncBlock(block: BasicBlock): BasicBlock {
        let node = this.block2NodeMap.get(block)!;
        let loop = this.loopMap.get(node)! as ForLoopRegion;
        return loop.inc.getBlock()!;
    }

    public preOrder(node: AbstractNode, callback: TraversalCallback, visitor: Set<AbstractNode> = new Set()) {
        visitor.add(node);
        node.traversal(callback, CodeBlockType.NORMAL);
        for (const succ of node.getSucc()) {
            if (!visitor.has(succ)) {
                this.preOrder(succ, callback, visitor);
            }
        }
    }

    private structuralAnalysis() {
        this.nodes = this.dfsPostOrder(this.entry);
        this.buildCyclicStructural();

        // acyclic structural
        let postMax = this.nodes.length;
        let change = true;
        while (postMax > 1 && change) {
            change = false;
            for (let i = 0; i < postMax; i++) {
                let node = this.nodes[i];
                let nset = new Set<AbstractNode>();
                let rtype = this.identifyRegionType(node, nset);
                if (rtype !== undefined) {
                    let p = this.reduce(rtype, nset);
                    if (p) {
                        if (nset.has(this.entry)) {
                            this.entry = p;
                        }
                        this.nodes = this.dfsPostOrder(this.entry);
                        postMax = this.nodes.length;
                        change = true;
                    }
                }
            }
        }
    }

    private dfsPostOrder(
        node: AbstractNode,
        visitor: Set<AbstractNode> = new Set(),
        postOrder: AbstractNode[] = []
    ): AbstractNode[] {
        visitor.add(node);
        for (const succ of node.getSucc()) {
            if (visitor.has(succ)) {
                continue;
            }
            this.dfsPostOrder(succ, visitor, postOrder);
        }
        postOrder.push(node);
        return postOrder;
    }

    private buildCyclicStructural(): void {
        for (const loop of this.prepareBuildLoops()) {
            let nset = new Set<AbstractNode | Region>();
            for (const n of loop) {
                if (this.structOf.has(n)) {
                    nset.add(this.structOf.get(n)!);
                } else {
                    nset.add(n);
                }
            }
            let rtype = this.cyclicRegionType(nset);
            let region = this.createRegion(rtype, nset)! as NaturalLoopRegion;
            region.revise();
            this.structTypes.set(region, rtype);
            let blocks = new Set<AbstractNode>();
            for (const s of nset) {
                if (!this.structOf.has(s)) {
                    this.structOf.set(s, region);
                }
                if (this.structBlocks.has(s as Region)) {
                    for (const b of this.structBlocks.get(s as Region)!) {
                        blocks.add(b);
                    }
                } else {
                    blocks.add(s);
                }
            }
            this.structBlocks.set(region, blocks);
            this.loopMap.set(region.header, region);
        }
    }

    private prepareBuildLoops(): Set<AbstractNode>[] {
        let dom = this.buildDominator();
        let loops: Set<AbstractNode>[] = [];
        for (const header of this.nodes) {
            let innermost: Set<AbstractNode> | undefined;
            let longest: number = 0;

            let backEdges = this.getBackEdges(dom, header);
            if (backEdges.size === 0) {
                continue;
            }

            if (this.isSelfLoopNode(header)) {
                loops.push(new Set<AbstractNode>([header]));
            }

            for (const start of backEdges) {
                let loop = this.naturalLoop(start, header);
                if (!innermost || loop.size > longest) {
                    innermost = loop;
                    longest = loop.size;
                }
            }
            loops.push(innermost!);
        }
        loops.sort((a, b) => a.size - b.size);
        return loops;
    }

    private buildDominator(): Map<AbstractNode, Set<AbstractNode>> {
        let domin = new Map<AbstractNode, Set<AbstractNode>>();
        domin.set(this.entry, new Set<AbstractNode>([this.entry]));
        for (const node of this.nodes) {
            if (node !== this.entry) {
                domin.set(node, new Set<AbstractNode>(this.nodes));
            }
        }

        let change = true;
        while (change) {
            change = false;
            for (const node of this.nodes) {
                if (node === this.entry) {
                    continue;
                }
                let t = new Set<AbstractNode>(domin.get(node)!);
                for (const p of node.getPred()) {
                    t = this.setIntersect(t, domin.get(p)!);
                }
                t.add(node);
                if (!this.isSetEqual(t, domin.get(node)!)) {
                    change = true;
                    domin.set(node, t);
                }
            }
        }

        return domin;
    }

    private getBackEdges(dom: Map<AbstractNode, Set<AbstractNode>>, header: AbstractNode): Set<AbstractNode> {
        let backEdges = new Set<AbstractNode>();
        for (const n of header.getPred()) {
            // h dom n && n -> h
            if (dom.get(n)?.has(header)) {
                backEdges.add(n);
            }
        }
        return backEdges;
    }

    private naturalLoop(backEdgeStart: AbstractNode, backEdgeEnd: AbstractNode): Set<AbstractNode> {
        let stack: AbstractNode[] = [];
        let loop = new Set<AbstractNode>([backEdgeEnd, backEdgeStart]);

        stack.push(backEdgeStart);

        while (stack.length > 0) {
            let m = stack.shift()!;
            for (const pred of m.getPred()) {
                if (loop.has(pred)) {
                    continue;
                }
                loop.add(pred);
                stack.push(pred);
            }
        }

        return loop;
    }

    private isSelfLoopNode(node: AbstractNode): boolean {
        let inSucc = false;
        let inPred = false;

        for (const pred of node.getPred()) {
            if (pred === node) {
                inPred = true;
            }
        }

        for (const succ of node.getSucc()) {
            if (succ === node) {
                inSucc = true;
            }
        }

        return inSucc && inPred;
    }

    private isForLoopIncNode(node: AbstractNode): boolean {
        for (const loop of this.loopMap.values()) {
            if (loop.getType() === RegionType.FOR_LOOP_REGION) {
                if (node === (loop as ForLoopRegion).inc) {
                    return true;
                }
            }
        }
        return false;
    }

    private isValidInBlocks(node: AbstractNode): boolean {
        if (this.isForLoopIncNode(node) || node.hasIfStmt()) {
            return false;
        }

        return true;
    }

    private isIfRegion(node: AbstractNode, nodeSet: Set<AbstractNode>): boolean {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if (m.getSucc().length === 1 && m.getSucc()[0] === n) {
            nodeSet.add(node).add(m);
            return true;
        }

        return false;
    }

    private isIfExitRegion(node: AbstractNode, nodeSet: Set<AbstractNode>): boolean {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        if (m.hasReturnStmt()) {
            nodeSet.add(node).add(m);
            return true;
        }

        return false;
    }

    private isIfElseRegion(node: AbstractNode, nodeSet: Set<AbstractNode>): boolean {
        nodeSet.clear();
        if (node.getSucc().length !== 2) {
            return false;
        }
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if (
            (m.getSucc().length === 1 &&
                n.getSucc().length === 1 &&
                m.getPred().length === 1 &&
                n.getPred().length === 1 &&
                m.getSucc()[0] === n.getSucc()[0]) ||
            (m.getSucc().length === 0 && n.getSucc().length === 0)
        ) {
            nodeSet.add(node).add(m).add(n);
            return true;
        }

        return false;
    }

    private isBlockRegion(node: AbstractNode, nodeSet: Set<AbstractNode>): boolean {
        let n = node;
        let p = true;
        let s = n.getSucc().length === 1;
        nodeSet.clear();

        let blocks = [];
        while (p && s && !nodeSet.has(n) && this.isValidInBlocks(n)) {
            nodeSet.add(n);
            blocks.push(n);
            n = n.getSucc()[0];
            p = n.getPred().length === 1;
            s = n.getSucc().length === 1;
        }

        if (p && this.isValidInBlocks(n)) {
            if (!nodeSet.has(n)) {
                blocks.push(n);
            }
            nodeSet.add(n);
        }

        n = node;
        p = n.getPred().length === 1;
        s = true;
        while (p && s && this.isValidInBlocks(n)) {
            if (!nodeSet.has(n)) {
                blocks.unshift(n);
            }
            nodeSet.add(n);
            n = n.getPred()[0];
            if (nodeSet.has(n)) {
                break;
            }
            p = n.getPred().length === 1;
            s = n.getSucc().length === 1;
        }

        if (s && this.isValidInBlocks(n)) {
            if (!nodeSet.has(n)) {
                blocks.unshift(n);
            }
            nodeSet.add(n);
        }

        nodeSet.clear();
        for (const n of blocks) {
            nodeSet.add(n);
        }

        if (nodeSet.size >= 2) {
            return true;
        }
        return false;
    }

    private isIfBreakRegion(node: AbstractNode, nodeSet: Set<AbstractNode>, loop: NaturalLoopRegion): boolean {
        let m = node.getSucc()[0];
        nodeSet.clear();
        if (this.isExitLoop(m, this.structBlocks.get(loop)!)) {
            nodeSet.add(node);
            return true;
        }

        if (m.getSucc().length === 1 && this.isExitLoop(m.getSucc()[0], this.structBlocks.get(loop)!)) {
            nodeSet.add(node).add(m);
            return true;
        }

        return false;
    }

    private isIfContinueRegion(node: AbstractNode, nodeSet: Set<AbstractNode>, loop: NaturalLoopRegion): boolean {
        nodeSet.clear();
        let m = node.getSucc()[0];
        let n = node.getSucc()[1];
        if (loop.control.has(m)) {
            nodeSet.add(node);
            return true;
        }

        if (
            m.getSucc().length === 1 &&
            loop.control.has(m.getSucc()[0]) &&
            !loop.control.has(n) &&
            !this.isIfElseRegion(node, nodeSet)
        ) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }

    private isWhileRegion(node: AbstractNode, nodeSet: Set<AbstractNode>, loop: NaturalLoopRegion): boolean {
        nodeSet.clear();
        let m = node.getSucc()[0];
        if (loop.header === node && m.getSucc().length === 1 && m.getPred().length === 1 && m.getSucc()[0] === node) {
            nodeSet.add(node).add(m);
            return true;
        }
        return false;
    }

    private isForRegion(node: AbstractNode, nodeSet: Set<AbstractNode>, loop: NaturalLoopRegion): boolean {
        nodeSet.clear();
        if (loop.header === node && loop.getType() === RegionType.FOR_LOOP_REGION) {
            let forLoop = loop as ForLoopRegion;
            let blocks = node.getSucc()[0];
            if (
                forLoop.inc.getPred().length === 1 &&
                forLoop.inc.getPred()[0] === blocks &&
                blocks.getSucc().length === 1
            ) {
                nodeSet.add(node).add(forLoop.inc).add(blocks);
                return true;
            }
        }
        return false;
    }

    private isDoWhileRegion(node: AbstractNode, nodeSet: Set<AbstractNode>, loop: NaturalLoopRegion): boolean {
        nodeSet.clear();
        if (loop.back === node && loop.getType() === RegionType.DO_WHILE_LOOP_REGION) {
            let blocks = node.getPred()[0];
            if (blocks.getSucc().length === 1 && blocks.getSucc()[0] === node && node.getSucc()[0] === blocks) {
                nodeSet.add(blocks).add(node);
                return true;
            }
        }
        return false;
    }

    private identifyRegionType(node: AbstractNode, nodeSet: Set<AbstractNode>): RegionType | undefined {
        if (this.isBlockRegion(node, nodeSet)) {
            return RegionType.BLOCK_REGION;
        }

        let inLoop = false;
        let region = this.structOf.get(node);
        if (region && LOOP_TYPES.has(region?.getType())) {
            inLoop = true;
        }

        if (new Set(node.getPred()).has(node) && new Set(node.getSucc()).has(node)) {
            nodeSet.add(node);
            if (inLoop) {
                return region?.getType();
            }
            return RegionType.SELF_LOOP_REGION;
        }

        if (node.getSucc().length !== 2) {
            return undefined;
        }

        if (inLoop) {
            let loop = region as NaturalLoopRegion;
            if (!loop.control.has(node)) {
                if (this.isIfBreakRegion(node, nodeSet, loop)) {
                    return RegionType.IF_THEN_BREAK_REGION;
                }

                if (this.isIfContinueRegion(node, nodeSet, loop)) {
                    return RegionType.IF_THEN_CONTINUE_REGION;
                }
            }
            if (this.isWhileRegion(node, nodeSet, loop)) {
                return RegionType.WHILE_LOOP_REGION;
            }

            if (this.isForRegion(node, nodeSet, loop)) {
                return RegionType.FOR_LOOP_REGION;
            }

            if (this.isDoWhileRegion(node, nodeSet, loop)) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
        }

        // check for if
        if (this.isIfExitRegion(node, nodeSet)) {
            return RegionType.IF_THEN_EXIT_REGION;
        }
        if (this.isIfRegion(node, nodeSet)) {
            return RegionType.IF_REGION;
        }

        // check for an if else
        if (this.isIfElseRegion(node, nodeSet)) {
            return RegionType.IF_ELSE_REGION;
        }

        return undefined;
    }

    private cyclicRegionType(nodeSet: Set<AbstractNode>): RegionType {
        let nodes = Array.from(nodeSet);
        let header = nodes[0];
        if (nodeSet.size === 1) {
            let tail = nodes[0].getBlock()?.getTail();
            if (tail instanceof ArkIfStmt) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
            return RegionType.WHILE_LOOP_REGION;
        }

        let back = nodes[1];
        // exit loop from back
        if (!this.hasExitLoopSucc(header, nodeSet) && this.hasExitLoopSucc(back, nodeSet)) {
            return RegionType.DO_WHILE_LOOP_REGION;
        }

        if (this.hasExitLoopSucc(header, nodeSet) && this.hasExitLoopSucc(back, nodeSet)) {
            // header true exit loop --> exit is break
            if (!nodeSet.has(header.getSucc()[0])) {
                return RegionType.DO_WHILE_LOOP_REGION;
            }
        }

        // for
        if (back.getSucc().length === 1 && back.getBlock()?.getStmts()?.length === 1) {
            let isForLoop = true;
            for (const pred of header.getPred()) {
                if (nodeSet.has(pred) && pred !== back) {
                    isForLoop = false;
                }
            }
            if (isForLoop) {
                return RegionType.FOR_LOOP_REGION;
            }
        }

        return RegionType.WHILE_LOOP_REGION;
    }

    private hasExitLoopSucc(node: AbstractNode, nodeSet: Set<AbstractNode>): boolean {
        for (const succ of node.getSucc()) {
            if (!nodeSet.has(succ)) {
                return true;
            }
        }

        return false;
    }

    private isExitLoop(node: AbstractNode | Region, nodeSet: Set<AbstractNode>): boolean {
        if (this.structBlocks.has(node)) {
            for (const n of this.structBlocks.get(node)!) {
                if (!nodeSet.has(n)) {
                    return true;
                }
            }
        } else {
            if (!nodeSet.has(node)) {
                return true;
            }
        }

        return false;
    }

    private createRegion(rtype: RegionType, nodeSet: Set<AbstractNode>): Region | undefined {
        let node: Region | undefined;
        if (rtype === RegionType.BLOCK_REGION) {
            node = new BlockRegion(nodeSet);
        } else if (rtype === RegionType.IF_ELSE_REGION) {
            node = new IfElseRegion(nodeSet);
        } else if (rtype === RegionType.IF_REGION) {
            node = new IfRegion(nodeSet);
        } else if (rtype === RegionType.IF_THEN_EXIT_REGION) {
            node = new IfExitRegion(nodeSet);
        } else if (rtype === RegionType.IF_THEN_BREAK_REGION) {
            node = new IfBreakRegion(nodeSet);
        } else if (rtype === RegionType.IF_THEN_CONTINUE_REGION) {
            node = new IfContinueRegion(nodeSet);
        } else if (rtype === RegionType.SELF_LOOP_REGION) {
            node = new SelfLoopRegion(nodeSet);
        } else if (rtype === RegionType.WHILE_LOOP_REGION) {
            let whileLoop = new WhileLoopRegion(nodeSet);
            this.loopMap.set(whileLoop.header, whileLoop);
            node = whileLoop;
        } else if (rtype === RegionType.FOR_LOOP_REGION) {
            let forLoop = new ForLoopRegion(nodeSet);
            this.loopMap.set(forLoop.header, forLoop);
            node = forLoop;
        } else if (rtype === RegionType.DO_WHILE_LOOP_REGION) {
            let doWhileLoop = new DoWhileLoopRegion(nodeSet);
            this.loopMap.set(doWhileLoop.header, doWhileLoop);
            node = doWhileLoop;
        }

        return node;
    }

    private reduce(rtype: RegionType, nodeSet: Set<AbstractNode>): Region | undefined {
        let region = this.createRegion(rtype, nodeSet);
        region?.replace();
        if (region) {
            this.structTypes.set(region, rtype);
            let blocks = new Set<AbstractNode>();
            for (const s of nodeSet) {
                this.structOf.set(s, region);
                if (this.structBlocks.has(s as Region)) {
                    for (const b of this.structBlocks.get(s as Region)!) {
                        blocks.add(b);
                    }
                } else {
                    blocks.add(s);
                }
            }
            this.structBlocks.set(region, blocks);
        }
        return region;
    }

    private setIntersect(a: Set<AbstractNode>, b: Set<AbstractNode>): Set<AbstractNode> {
        let r = new Set<AbstractNode>();
        for (const n of b) {
            if (a.has(n)) {
                r.add(n);
            }
        }

        return r;
    }

    private isSetEqual(a: Set<AbstractNode>, b: Set<AbstractNode>): boolean {
        if (a.size !== b.size) {
            return false;
        }

        return this.setIntersect(a, b).size === a.size;
    }
}

enum RegionType {
    ABSTRACT_NODE,
    /* Sequence of blocks.  */
    BLOCK_REGION,
    IF_REGION,
    IF_ELSE_REGION,
    IF_THEN_EXIT_REGION,
    IF_THEN_BREAK_REGION,
    IF_THEN_CONTINUE_REGION,
    SELF_LOOP_REGION,
    NATURAL_LOOP_REGION,
    WHILE_LOOP_REGION,
    DO_WHILE_LOOP_REGION,
    FOR_LOOP_REGION,
    CASE_REGION,
    SWITCH_REGION,
}

const LOOP_TYPES = new Set<RegionType>([
    RegionType.SELF_LOOP_REGION,
    RegionType.NATURAL_LOOP_REGION,
    RegionType.WHILE_LOOP_REGION,
    RegionType.FOR_LOOP_REGION,
    RegionType.DO_WHILE_LOOP_REGION,
]);

class AbstractNode {
    type: RegionType;
    private predNodes: AbstractNode[] = [];
    private succNodes: AbstractNode[] = [];
    private bb: BasicBlock | undefined;

    constructor() {
        this.type = RegionType.ABSTRACT_NODE;
    }

    public traversal(callback: TraversalCallback, type: CodeBlockType) {
        callback(this.bb, type);
    }

    public getType(): RegionType {
        return this.type;
    }

    public getSucc(): AbstractNode[] {
        return this.succNodes;
    }

    public addSucc(node: AbstractNode) {
        this.succNodes.push(node);
    }

    public replaceSucc(src: AbstractNode, dst: AbstractNode) {
        for (let i = 0; i < this.succNodes.length; i++) {
            if (this.succNodes[i] === src) {
                this.succNodes[i] = dst;
                break;
            }
        }
    }

    public removeSucc(src: AbstractNode) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.succNodes[i] === src) {
                this.succNodes.splice(i, 1);
                break;
            }
        }
    }

    public getPred(): AbstractNode[] {
        return this.predNodes;
    }

    public addPred(block: AbstractNode): void {
        this.predNodes.push(block);
    }

    public replacePred(src: AbstractNode, dst: AbstractNode) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.predNodes[i] === src) {
                this.predNodes[i] = dst;
                break;
            }
        }
    }

    public removePred(src: AbstractNode) {
        for (let i = 0; i < this.predNodes.length; i++) {
            if (this.predNodes[i] === src) {
                this.predNodes.splice(i, 1);
                break;
            }
        }
    }

    public setBlock(bb: BasicBlock) {
        this.bb = bb;
    }

    public getBlock(): BasicBlock | undefined {
        return this.bb;
    }

    public hasIfStmt(): boolean {
        if (!this.bb) {
            return false;
        }

        for (let stmt of this.bb.getStmts()) {
            if (stmt instanceof ArkIfStmt) {
                return true;
            }
        }
        return false;
    }

    public hasReturnStmt(): boolean {
        if (!this.bb) {
            return false;
        }
        for (let stmt of this.bb.getStmts()) {
            if (stmt instanceof ArkReturnStmt) {
                return true;
            }
        }
        return false;
    }
}

abstract class Region extends AbstractNode {
    nset: Set<AbstractNode>;
    constructor(nset: Set<AbstractNode>, type: RegionType) {
        super();
        this.nset = nset;
        this.type = type;
    }

    public abstract replace(): void;
}

class BlockRegion extends Region {
    blocks: AbstractNode[];
    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.BLOCK_REGION);
        this.blocks = Array.from(nset);
    }

    public replace() {
        for (let pred of this.blocks[0].getPred()) {
            pred.replaceSucc(this.blocks[0], this);
            this.addPred(pred);
        }

        for (let succ of this.blocks[this.blocks.length - 1].getSucc()) {
            succ.replacePred(this.blocks[this.blocks.length - 1], this);
            this.addSucc(succ);
        }
    }

    public traversal(callback: TraversalCallback) {
        for (const node of this.blocks) {
            node.traversal(callback, CodeBlockType.NORMAL);
        }
    }
}

abstract class NaturalLoopRegion extends Region {
    header: AbstractNode;
    back: AbstractNode;
    control: Set<AbstractNode>;

    constructor(nset: Set<AbstractNode>, type: RegionType = RegionType.NATURAL_LOOP_REGION) {
        super(nset, type);
        let nodes = Array.from(nset);
        this.header = nodes[0];
        if (nset.size > 1) {
            this.back = nodes[1];
        } else {
            this.back = nodes[0];
        }
        this.control = new Set([this.header]);
    }

    public replace(): void {
        for (let pred of this.header.getPred()) {
            if (!this.nset.has(pred)) {
                pred.replaceSucc(this.header, this);
                this.addPred(pred);
            }
        }

        let succNodes = new Set<AbstractNode>();
        for (let node of this.nset) {
            for (let succ of node.getSucc()) {
                if (!this.nset.has(succ)) {
                    succNodes.add(succ);
                }
            }
        }

        if (succNodes.size === 0) {
            return;
        }

        let pred = Array.from(succNodes)[0];
        let replaced = false;
        for (let succ of pred.getPred()) {
            if (this.nset.has(succ)) {
                if (!replaced) {
                    pred.replacePred(succ, this);
                    this.addSucc(pred);
                    replaced = true;
                } else {
                    pred.removePred(succ);
                }
            }
        }
    }

    public revise(): void {
        // add node to loop sets
        for (const node of this.nset) {
            for (const succ of node.getSucc()) {
                if (
                    !this.nset.has(succ) &&
                    succ !== this.getExitNode() &&
                    succ.getSucc().length === 1 &&
                    succ.getSucc()[0] === this.getExitNode()
                ) {
                    this.nset.add(succ);
                }
            }
        }
    }

    abstract getExitNode(): AbstractNode;
}

class SelfLoopRegion extends NaturalLoopRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.SELF_LOOP_REGION);
        this.back = this.header;
    }

    public replace() {
        for (let pred of this.header.getPred()) {
            if (pred !== this.header) {
                pred.replaceSucc(this.header, this);
                this.addPred(pred);
            }
        }

        for (let succ of this.header.getSucc()) {
            if (succ !== this.header) {
                succ.replacePred(this.header, this);
                this.addSucc(succ);
            }
        }
    }

    getExitNode(): AbstractNode {
        return this.header.getSucc()[1];
    }
}

class WhileLoopRegion extends NaturalLoopRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.WHILE_LOOP_REGION);
    }

    public traversal(callback: TraversalCallback) {
        this.header.traversal(callback, CodeBlockType.WHILE);
        if (this.header !== this.back) {
            this.back.traversal(callback, CodeBlockType.NORMAL);
        }
        callback(undefined, CodeBlockType.COMPOUND_END);
    }

    getExitNode(): AbstractNode {
        return this.header.getSucc()[1];
    }
}

class DoWhileLoopRegion extends NaturalLoopRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.DO_WHILE_LOOP_REGION);
        this.control.clear();
        this.control.add(this.back);
    }

    public traversal(callback: TraversalCallback) {
        callback(undefined, CodeBlockType.DO);
        if (this.header !== this.back) {
            this.header.traversal(callback, CodeBlockType.NORMAL);
        }
        this.back.traversal(callback, CodeBlockType.DO_WHILE);
    }

    getExitNode(): AbstractNode {
        return this.back.getSucc()[1];
    }
}

class ForLoopRegion extends NaturalLoopRegion {
    inc: AbstractNode;

    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.FOR_LOOP_REGION);
        this.inc = this.back;
        this.control.add(this.inc);
    }

    public traversal(callback: TraversalCallback) {
        this.header.traversal(callback, CodeBlockType.FOR);
        for (const node of this.nset) {
            if (node !== this.header && node !== this.inc) {
                node.traversal(callback, CodeBlockType.NORMAL);
            }
        }
        callback(undefined, CodeBlockType.COMPOUND_END);
    }

    getExitNode(): AbstractNode {
        return this.header.getSucc()[1];
    }
}

class IfRegion extends Region {
    contition: AbstractNode;
    then: AbstractNode;

    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.IF_REGION);
        let nodes = Array.from(nset);
        this.contition = nodes[0];
        this.then = nodes[1];
    }

    public replace(): void {
        this.replaceContitionPred();

        for (let succ of this.then.getSucc()) {
            if (succ !== this.then) {
                succ.replacePred(this.then, this);
                succ.removePred(this.contition);
                this.addSucc(succ);
            }
        }
    }

    public traversal(callback: TraversalCallback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }

    protected replaceContitionPred(): void {
        for (let pred of this.contition.getPred()) {
            if (pred !== this.contition) {
                pred.replaceSucc(this.contition, this);
                this.addPred(pred);
            }
        }
    }
}

class IfExitRegion extends IfRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset);
        this.type = RegionType.IF_THEN_EXIT_REGION;
    }

    public replace() {
        this.replaceContitionPred();;

        let succ = this.contition.getSucc()[1];
        succ.replacePred(this.contition, this);
        this.addSucc(succ);
    }

    
}

class IfBreakRegion extends IfRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset);
        this.type = RegionType.IF_THEN_BREAK_REGION;
    }

    public replace() {
        this.replaceContitionPred();
        
        let succ = this.contition.getSucc()[1];
        succ.replacePred(this.contition, this);
        this.addSucc(succ);

        if (this.then) {
            succ = this.then.getSucc()[0];
            succ.removePred(this.then);
        } else {
            succ = this.contition.getSucc()[0];
            succ.removePred(this.contition);
        }
    }

    public traversal(callback: TraversalCallback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then?.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.BREAK);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}

class IfContinueRegion extends IfBreakRegion {
    constructor(nset: Set<AbstractNode>) {
        super(nset);
        this.type = RegionType.IF_THEN_CONTINUE_REGION;
    }

    public traversal(callback: TraversalCallback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then?.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.CONTINUE);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}

class IfElseRegion extends Region {
    contition: AbstractNode;
    then: AbstractNode;
    else: AbstractNode;

    constructor(nset: Set<AbstractNode>) {
        super(nset, RegionType.IF_ELSE_REGION);
        let nodes = Array.from(nset);
        this.contition = nodes[0];
        this.then = nodes[1];
        this.else = nodes[2];
    }

    public replace() {
        for (let pred of this.contition.getPred()) {
            if (pred !== this.contition) {
                pred.replaceSucc(this.contition, this);
                this.addPred(pred);
            }
        }

        for (let succ of this.then.getSucc()) {
            if (succ !== this.then) {
                succ.replacePred(this.then, this);
                succ.removePred(this.else);
                this.addSucc(succ);
            }
        }
    }

    public traversal(callback: TraversalCallback) {
        this.contition.traversal(callback, CodeBlockType.IF);
        this.then.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.ELSE);
        this.else.traversal(callback, CodeBlockType.NORMAL);
        callback(undefined, CodeBlockType.COMPOUND_END);
    }
}
