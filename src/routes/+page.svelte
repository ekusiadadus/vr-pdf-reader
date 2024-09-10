<!-- src/routes/vr-pdf-reader/+page.svelte -->
<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import * as BABYLON from 'babylonjs';
	import 'babylonjs-loaders';

	let canvas;
	let vrPDFReader;
	let pdfjsLib;
	let isVRAvailable = false;
	let currentPage = 1;
	let totalPages = 0;

	// Promise.withResolvers polyfill
	if (typeof Promise.withResolvers === 'undefined') {
		if (typeof window !== 'undefined') {
			window.Promise.withResolvers = () => {
				let resolve, reject;
				const promise = new Promise((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};
		} else {
			global.Promise.withResolvers = () => {
				let resolve, reject;
				const promise = new Promise((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};
		}
	}

	class VRPDFReader {
		constructor(canvas) {
			this.canvas = canvas;
			this.engine = new BABYLON.Engine(this.canvas, true);
			this.scene = new BABYLON.Scene(this.engine);
			this.pdfDoc = null;
			this.currentPage = 1;
			this.pdfTexture = null;
			this.pdfMesh = null;
			this.pageTextMesh = null;
			this.scale = 1;
		}

		async initialize() {
			const camera = new BABYLON.ArcRotateCamera(
				'camera',
				-Math.PI / 2,
				Math.PI / 2.5,
				3,
				new BABYLON.Vector3(0, 0, 0),
				this.scene
			);
			camera.attachControl(this.canvas, true);
			new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);

			if (isVRAvailable) {
				const vrHelper = this.scene.createDefaultVRExperience({
					createDeviceOrientationCamera: false
				});
				if (vrHelper.isAvailable) {
					vrHelper.enableInteractions();
					this.setupControllers(vrHelper);
				} else {
					console.warn('VR is not available on this device/browser');
				}
			}

			this.pdfMesh = BABYLON.MeshBuilder.CreatePlane(
				'pdfPlane',
				{ width: 1.5, height: 2 },
				this.scene
			);
			this.pdfMesh.position.z = 2;

			this.engine.runRenderLoop(() => {
				this.scene.render();
			});

			this.pageTextMesh = BABYLON.MeshBuilder.CreatePlane(
				'pageText',
				{ width: 0.5, height: 0.1 },
				this.scene
			);
			this.pageTextMesh.position.set(0, -1.1, 2);
			const pageTextMaterial = new BABYLON.StandardMaterial('pageTextMaterial', this.scene);
			this.pageTextMesh.material = pageTextMaterial;

			window.addEventListener('resize', () => {
				this.engine.resize();
			});
		}

		setupControllers(vrHelper) {
			vrHelper.onControllerMeshLoaded.add((webVRController) => {
				webVRController.onTriggerStateChangedObservable.add((state) => {
					if (state.value > 0.5) {
						if (webVRController.hand === 'left') {
							this.prevPage();
						} else {
							this.nextPage();
						}
					}
				});

				// 新しい機能: PDFの位置調整
				webVRController.onPadValuesChangedObservable.add((stateObject) => {
					const { x, y } = stateObject;
					if (Math.abs(y) > 0.1) {
						this.pdfMesh.position.z += y * 0.1;
					}
					if (Math.abs(x) > 0.1) {
						this.scale += x * 0.1;
						this.scale = Math.max(0.5, Math.min(this.scale, 2)); // スケールを0.5から2の間に制限
						this.pdfMesh.scaling = new BABYLON.Vector3(this.scale, this.scale, 1);
					}
				});
			});
		}
		async loadPDF(url) {
			const loadingTask = pdfjsLib.getDocument(url);
			this.pdfDoc = await loadingTask.promise;
			totalPages = this.pdfDoc.numPages;
			await this.renderPage(1);
		}

		async renderPage(num) {
			const page = await this.pdfDoc.getPage(num);
			const scale = 1.5;
			const viewport = page.getViewport({ scale });

			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;

			const renderContext = {
				canvasContext: context,
				viewport: viewport
			};
			await page.render(renderContext).promise;

			if (this.pdfTexture) {
				this.pdfTexture.dispose();
			}
			this.pdfTexture = new BABYLON.DynamicTexture(
				'pdfTexture',
				{ width: canvas.width, height: canvas.height },
				this.scene
			);

			const ctx = this.pdfTexture.getContext();
			ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
			this.pdfTexture.update();

			const material = new BABYLON.StandardMaterial('pdfMaterial', this.scene);
			material.diffuseTexture = this.pdfTexture;
			this.pdfMesh.material = material;

			this.currentPage = num;
			currentPage = num; // Update the Svelte store
			this.updatePageNumberText();
		}
		updatePageNumberText() {
			const dynamicTexture = new BABYLON.DynamicTexture('pageNumberTexture', 256, this.scene, true);
			const ctx = dynamicTexture.getContext();
			ctx.font = '24px Arial';
			ctx.fillStyle = 'white';
			ctx.textAlign = 'center';
			ctx.fillText(`Page ${this.currentPage} / ${totalPages}`, 128, 40);
			dynamicTexture.update();

			this.pageTextMesh.material.diffuseTexture = dynamicTexture;
		}

		nextPage() {
			if (this.currentPage < this.pdfDoc.numPages) {
				this.renderPage(this.currentPage + 1);
			}
		}

		prevPage() {
			if (this.currentPage > 1) {
				this.renderPage(this.currentPage - 1);
			}
		}
	}

	onMount(async () => {
		if (browser) {
			const pdfjs = await import('pdfjs-dist');
			pdfjsLib = pdfjs;

			pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
				'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
				import.meta.url
			).toString();

			// Check if VR is available
			isVRAvailable = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync('immersive-vr');

			vrPDFReader = new VRPDFReader(canvas);
			await vrPDFReader.initialize();
			await vrPDFReader.loadPDF('/cannovelresearch.pdf');
		}
	});

	function handleKeydown(event) {
		if (event.key === 'ArrowRight') {
			vrPDFReader.nextPage();
		} else if (event.key === 'ArrowLeft') {
			vrPDFReader.prevPage();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<canvas bind:this={canvas}></canvas>

{#if !isVRAvailable}
	<div class="non-vr-controls">
		<button on:click={() => vrPDFReader.prevPage()}>Previous Page</button>
		<span>Page {currentPage} / {totalPages}</span>
		<button on:click={() => vrPDFReader.nextPage()}>Next Page</button>
	</div>
{/if}

<style>
	canvas {
		width: 100%;
		height: 100vh;
	}
	.non-vr-controls {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 10px;
		background-color: rgba(0, 0, 0, 0.5);
		padding: 10px;
		border-radius: 5px;
	}
	.non-vr-controls span {
		color: white;
	}
</style>
