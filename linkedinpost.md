![stroke to vector of points](image.png)

![vector normalisation workflow](image-1.png)


![enable enable debug](image-2.png)

![new tab added in settings- handwriting](image-3.png)

use # export_onnx.py which i made inside of the onlineHTR(@credits to https://github.com/PellelNitram/OnlineHTR/#) directory to Export to ONNX yourself from the checkpoint


i took the official tldraw plugin for obsidian and made it such that your handwriting is autorecognised (through google's ime engine api request by default and added support for onnx based models[also have a script that converts ckpt to onnx]) . added ctrl+f to fuzzy search your handwriting(the canvas is zoomed in to that approximate text block and its highlighted-- not exact to prevent api blacklisting/high performance deficit). added a new pencil that has custom sizes (apart from the usual s m l xl sizes by default in the tldraw pen), it has better pressure sensitivity. i added dark mode support. tried adding svg based texture to the pencil but haven't succeeded yet. the recognised words are stored persistently  , they are only re recognised if moved/ the word batch is tampered with (e.g you can split a word into two). add constructive criticism , what you like and don't like about this. keep in mind this is supposed to be for production , think from obsidian users' perspective, a detective's perspective etc. why / why not a person would use it, what can be improved etc

The single-language-at-a-time limitation from Google is a real constraint, not a design failure. Worth documenting clearly so users don't think it's a bug when they switch languages.

the offline model thing is something i wish to offload to a contributor, i tried it lots and lots of times but couldn't succeed..On the offline model — understood, and honestly the right call to offload it. Just make sure the contributor path is well-documented: what the expected input/output format is, what accuracy threshold you'd accept, how it plugs into your existing pipeline. A good CONTRIBUTING.md here will attract the right person.





ok , so far i have implemented --
1. handwriting recog. and search
2. good enough pencil texture (although there are performance issues). working on custom brush stamps
3. ability to paste ANY link as resizable iframe, ability to pin(say a youtube video) to your screen (canvas moves but the video floats in place)
4. special feature for youtube playlists -- once you paste a youtube playlist , all of its videos are listed in a menu(with there names and links , their thumbnails and full titles are previewed on hover) where you can flip through the videos or search for a video in the playlist
5. better dark mode
6. alt + drag to set custom brush size like in krita 
7. added performance monitor
8. added ability to wiki link other files within the canvas using a keyboard shortcut. ability to convert a handwritten text into a wikilink to a file

9. all other default tldraw features like hold shift to draw a line(or tap a point hold shift and tap another point to create a line between them), basic shapes like rect, circle, triangle etc. , a lazer pointer, text etc.



stuff that i request other people to fix: 
1.the debug settings in the startup tab doesn't work well.
2.add support for mathematical symbols


features to add further-- 1.in the anchor links, if you right click an anchor link , you should be able to open a file inside the canvas , e.g a markdown file or even a canvas inside a canvas -- in an iframe similar to the youtube videos thing

2.gestures for shapes like in procreate

3.a birdeye map of the project like in fps games, you can place flags that appear in the map -- physically it replaces the space where the pencil/pen menu once was

4. ui changes to make almost everything collapsable to declutter the space

5. find and replace, similar to vscode (use tldraw inbuilt font , and instead of deleting the word, just add the new replacement glowing red on top with a offset, use bounding box to determine font size)

6. ability to link frames(right click selection) with lines(snap to frames) , the connection points stay attached to the frame even when moving them around(like in affine)

7. continue videos where you left off last time. same with Notes.

8. add a bar to change flow and opacity of pencil-- bcz the pencil does not feel bright and sharp enough without applying full pressure(this may wear out my stylus). change the stamp from circular to elliptical perhaps or a mix or both to provide a more natural feel. also add a smoothening control bar in settings (global for both pen and pencil).
issues:

9. add support for 3d files (maybe convert stl/ other formats into gltf or glb for easier rendering)

10. pdf support (10.a. iframe inside edgeless canvas -- strokes made on the pdf are bound to the pdf, meaning when scrolled through the pdf the strokes move too, make sure to not "follow the pdf" but actually make them bound to each other; 10.b. pdf as canvas , all features of the plugin except the fact that the pdf behaves as a finite bound canvas) 

11. custom background color and texture(repeating image tiles)

12. single click E for brush , click again for brush

13. add the chrome "ask google about this page" feature, everything -- canvas, pdf etc. (like an obsidian native button)
issues-

the ctrl + F works weird, as soon as you press ctrl + f you can immediately transported to a place even without clicking anything

the pencil isn't able to change color

the pen is behaving like the pencil

the pencil menu UI is clunky. We need a way to hide the menu bcz it obstructs a lot of view space

if you draw fast, the stamp density decreases. if a stroke runs long enough , the rest of the stroke becomes a pen stroke

a lot of options in youtube videos are missing like skip 10 seconds or captions or fullscreen  (like actual screen not just canvas) or ask gemini etc. the options bar of the youtube video is very bad in terms of scaling (doesn't scale to the width of the iframe) . also we should be able to use ALL youtube shortcuts when the iframe is selected

normal offline video files don't have controls to them

sometimes mouse click doesn't work if drawing tablet is connected

need bug and performance testing in canvas containing one or more youtube videos (one time there was a pause play bug and another time i face a lot of lag when using the pencil while a video played) . also sometimes the bitmap caches just stops happening if i let the canvas run long enough.



bitmap cache performance bug observed : it has been observed that caching occurs each time i open a file, meaning cache is never actually saved in permanent storage. also deletion of more than 50 strokes of pencil take a long time. 


youtube video links like https://www.youtube.com/watch?v=Ck6k1ulzgec&list=PLBlnK6fEyqRhG6s3jYIU48CqsT5cyiDTO&index=144 are actually treated like playlists instead of single video . solution-- add a dialog box to choose whether to import single video or the entire playlist
