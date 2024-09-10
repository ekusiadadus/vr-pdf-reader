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
	let isInVR = false;

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
			this.isFlipping = false;
			this.loadingTexture = null;
			this.pageInfoTexture = null;
			this.isInitialized = false;
		}

		async initialize() {
			try {
				this.scene.clearColor = new BABYLON.Color3(0, 0, 0);

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
					const xrHelper = await this.scene.createDefaultXRExperienceAsync({
						floorMeshes: [
							BABYLON.MeshBuilder.CreateGround('ground', { width: 6, height: 6 }, this.scene)
						],
						uiOptions: {
							sessionMode: 'immersive-vr',
							referenceSpaceType: 'local-floor'
						},
						optionalFeatures: true
					});

					const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', this.scene);
					groundMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
					xrHelper.baseExperience.renderTarget.renderList[0].material = groundMaterial;

					if (xrHelper.baseExperience) {
						xrHelper.baseExperience.onStateChangedObservable.add((state) => {
							if (state === BABYLON.WebXRState.IN_XR) {
								isInVR = true;
							} else if (state === BABYLON.WebXRState.NOT_IN_XR) {
								isInVR = false;
							}
						});

						this.setupControllers(xrHelper);
						this.setupExitVRButton(xrHelper);
					} else {
						console.warn('WebXR not available on this device/browser');
					}
				}

				this.pdfMesh = BABYLON.MeshBuilder.CreatePlane(
					'pdfPlane',
					{ width: 1.5, height: 2 },
					this.scene
				);
				this.pdfMesh.position.z = 2;

				await this.createLoadingIndicator();
				await this.createPageInfo();

				this.engine.runRenderLoop(() => {
					this.scene.render();
				});

				window.addEventListener('resize', () => {
					this.engine.resize();
				});

				this.isInitialized = true;
			} catch (error) {
				console.error('Error during initialization:', error);
				this.updateLoadingTexture('Error initializing VR PDF Reader');
			}
		}

		setupControllers(xrHelper) {
			xrHelper.input.onControllerAddedObservable.add((controller) => {
				controller.onMotionControllerInitObservable.add((motionController) => {
					const xr_ids = motionController.getComponentIds();
					let triggerComponent = motionController.getComponent(xr_ids[0]);

					triggerComponent.onButtonStateChangedObservable.add((component) => {
						if (component.pressed) {
							if (controller.handedness === 'left') {
								this.prevPage();
							} else if (controller.handedness === 'right') {
								this.nextPage();
							}
						}
					});
				});
			});
		}

		setupExitVRButton(xrHelper) {
			const exitVRButton = document.createElement('button');
			exitVRButton.textContent = 'Exit VR';
			exitVRButton.style.position = 'absolute';
			exitVRButton.style.bottom = '10px';
			exitVRButton.style.left = '10px';
			exitVRButton.style.display = 'none';

			exitVRButton.onclick = () => {
				xrHelper.baseExperience.exitXRAsync();
			};

			xrHelper.baseExperience.onStateChangedObservable.add((state) => {
				if (state === BABYLON.WebXRState.IN_XR) {
					exitVRButton.style.display = 'block';
				} else if (state === BABYLON.WebXRState.NOT_IN_XR) {
					exitVRButton.style.display = 'none';
				}
			});

			document.body.appendChild(exitVRButton);
		}

		async createLoadingIndicator() {
			const loadingMaterial = new BABYLON.StandardMaterial('loadingMaterial', this.scene);
			this.loadingTexture = new BABYLON.DynamicTexture(
				'loadingTexture',
				{ width: 512, height: 256 },
				this.scene
			);
			loadingMaterial.diffuseTexture = this.loadingTexture;

			const loadingPlane = BABYLON.MeshBuilder.CreatePlane(
				'loadingPlane',
				{ width: 1, height: 0.5 },
				this.scene
			);
			loadingPlane.position.z = 2;
			loadingPlane.material = loadingMaterial;

			await this.updateLoadingTexture('Initializing...');
		}

		async createPageInfo() {
			const pageInfoMaterial = new BABYLON.StandardMaterial('pageInfoMaterial', this.scene);
			this.pageInfoTexture = new BABYLON.DynamicTexture(
				'pageInfoTexture',
				{ width: 256, height: 128 },
				this.scene
			);
			pageInfoMaterial.diffuseTexture = this.pageInfoTexture;

			const pageInfoPlane = BABYLON.MeshBuilder.CreatePlane(
				'pageInfoPlane',
				{ width: 0.5, height: 0.25 },
				this.scene
			);
			pageInfoPlane.position.set(0, -1.2, 2);
			pageInfoPlane.material = pageInfoMaterial;
		}

		async updateLoadingTexture(text) {
			if (!this.loadingTexture) {
				console.warn('Loading texture not initialized');
				return;
			}
			const ctx = this.loadingTexture.getContext();
			ctx.clearRect(0, 0, 512, 256);
			ctx.fillStyle = 'white';
			ctx.font = 'bold 48px Arial';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(text, 256, 128);
			this.loadingTexture.update();
		}

		async updatePageInfo() {
			if (!this.pageInfoTexture) {
				console.warn('Page info texture not initialized');
				return;
			}
			const ctx = this.pageInfoTexture.getContext();
			ctx.clearRect(0, 0, 256, 128);
			ctx.fillStyle = 'white';
			ctx.font = 'bold 32px Arial';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(
				`Page ${this.currentPage} of ${this.pdfDoc ? this.pdfDoc.numPages : 'N/A'}`,
				128,
				64
			);
			this.pageInfoTexture.update();
		}

		async loadPDF(url) {
			if (!this.isInitialized) {
				console.error('VRPDFReader not initialized');
				return;
			}
			try {
				await this.updateLoadingTexture('Loading PDF...');
				const loadingTask = pdfjsLib.getDocument(url);
				this.pdfDoc = await loadingTask.promise;
				await this.renderPage(1);
				await this.updatePageInfo();
				const loadingPlane = this.scene.getMeshByName('loadingPlane');
				if (loadingPlane) {
					loadingPlane.dispose();
				}
			} catch (error) {
				console.error('Error loading PDF:', error);
				await this.updateLoadingTexture('Error loading PDF');
			}
		}
		async renderPage(num) {
			const page = await this.pdfDoc.getPage(num);
			const scale = 1.5;
			const viewport = page.getViewport({ scale });

			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;
			this.currentPage = num;
			this.updatePageInfo();

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

			isVRAvailable = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync('immersive-vr');

			vrPDFReader = new VRPDFReader(canvas);
			await vrPDFReader.initialize();
			await vrPDFReader.loadPDF('/cannovelresearch.pdf');
		}
	});
</script>

<canvas bind:this={canvas}></canvas>

{#if !isVRAvailable}
	<div class="non-vr-controls">
		<button on:click={() => vrPDFReader.prevPage()}>Previous Page</button>
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
	}
</style>
