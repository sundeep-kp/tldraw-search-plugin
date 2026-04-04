![stroke to vector of points](image.png)

![vector normalisation workflow](image-1.png)


![enable enable debug](image-2.png)

![new tab added in settings- handwriting](image-3.png)

use # export_onnx.py which i made inside of the onlineHTR(@credits to https://github.com/PellelNitram/OnlineHTR/#) directory to Export to ONNX yourself from the checkpoint


i took the official tldraw plugin for obsidian and made it such that your handwriting is autorecognised (through google's ime engine api request by default and added support for onnx based models[also have a script that converts ckpt to onnx]) . added ctrl+f to fuzzy search your handwriting(the canvas is zoomed in to that approximate text block and its highlighted-- not exact to prevent api blacklisting/high performance deficit). added a new pencil that has custom sizes (apart from the usual s m l xl sizes by default in the tldraw pen), it has better pressure sensitivity. i added dark mode support. tried adding svg based texture to the pencil but haven't succeeded yet. the recognised words are stored persistently  , they are only re recognised if moved/ the word batch is tampered with (e.g you can split a word into two). add constructive criticism , what you like and don't like about this. keep in mind this is supposed to be for production , think from obsidian users' perspective, a detective's perspective etc. why / why not a person would use it, what can be improved etc

The single-language-at-a-time limitation from Google is a real constraint, not a design failure. Worth documenting clearly so users don't think it's a bug when they switch languages.

the offline model thing is something i wish to offload to a contributor, i tried it lots and lots of times but couldn't succeed..On the offline model — understood, and honestly the right call to offload it. Just make sure the contributor path is well-documented: what the expected input/output format is, what accuracy threshold you'd accept, how it plugs into your existing pipeline. A good CONTRIBUTING.md here will attract the right person.




stuff that i request other people to fix: 
1.the debug settings in the startup tab doesn't work well.
