/**
 * @fileoverview This file implements the C1Pjs Video component
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * Created 2012-Jun-15
 *
 * Copyright © 2012-2015 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of C1Pjs, which is part of the JavaScript Machines Project (aka JSMachines)
 * at <http://jsmachines.net/> and <http://pcjs.org/>.
 *
 * C1Pjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * C1Pjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with C1Pjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some C1Pjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * C1Pjs program for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

"use strict";

/**
 * C1PVideo(parmsVideo, eCanvas, context, imgChars)
 *
 * The Video component can be configured with the following (parmsVideo) properties:
 *
 *      model: model number (one of: 540 or 600; 600 is the default)
 *      screenWidth: width of the screen window, in pixels
 *      screenHeight: height of the screen window, in pixels
 *      charCols: number of character columns
 *      charRows: number of character rows
 *      charWidth: width of charSet characters, in pixels (default is 0)
 *      charHeight: height of charSet characters, in pixels (default is 0)
 *      charSet: path to image (eg, PNG) file that defines the character set
 *      screenColor: background color of the screen window (default is black)
 *
 * The Video object assumes that the video buffer is organized such that offset 0 is mapped
 * to the left-most column and top-most row (col=0,row=0), offset 1 is (1,0), offset 2
 * is (2,0), and so on.
 *
 * The Video object initially contains no underlying video buffer; memory for the buffer
 * must be given to it by the Computer object.  We allocate a separate buffer, called
 * the screen buffer, into which we periodically copy the contents of the video buffer
 * via updateScreen(); any differences between the two buffers are then rendered in the
 * associated window, via updateWindow().
 *
 * When updateScreen() finds a byte in the screen buffer must be redisplayed, it converts
 * the offset of that byte into a (col,row) character position for the updateWindow() function,
 * which then converts (col,row) into (x,y) pixel offsets within the underlying canvas.
 *
 * Regarding the C1P (aka Model 600): The C1P has a 1K video buffer located at 0xD000-0xD3FF.
 * The ROM draws the initial "D/C/W/M ?" prompt at the "bottom" of the video buffer at location
 * 0xD365. That row really begins at 0xD360, but the C1P "indents" everything by 5 columns due
 * to the lack of a "guard band feature."  Similarly, BASIC defaults to a width of 24 columns
 * avoid display problems near the right edge.  BASIC will let you choose a width SMALLER than
 * 24 but not larger. So, while the video buffer supports a theoretical maximum of 32 rows x 32
 * columns, the practical maximum is 24 rows x 24 columns; the last 4 rows of the video buffer
 * are never used, and while content scrolls through the top 4 lines of the buffer, it is never
 * assumed that you can see the top 4 lines.
 *
 * This is partially confirmed by the "C1P Character Graphics Reference Manual", p3, which says
 * that the "the visible character field consists of 25 lines of 25 columns" and that the "first
 * visible character in the upper left of the screen is accessed via address 53379," or 0xD083,
 * confirming that the first 4 lines are not assumed to be visible.  However, the comment
 * regarding "25 lines of 25 columns" seems to be off by one in both dimensions.  And why would
 * they say that the first visible address is 0xD083 instead of 0xD085?  An indentation of 5 bytes,
 * rather than 3, would be more consistent with how the C1P ROMs use video memory.
 *
 * Model 540 Video Board vs. Model 600 "Superboard II"
 * ---------------------------------------------------
 * This emulation was originally written for the Model 600 "Superboard II" (eg, Challenger 1P).
 * Support for the Model 540 video board (as used in the Challenger II-4P and II-8P) was added
 * later.
 *
 * NOTE: When Model 540 video emulation is enabled, Model 542 keyboard emulation must also be
 * enabled, because the former always came with the latter keyboard interface; this is why when
 * we call this.setModel(540), we must also notify the Keyboard via kbd.setModel(542).
 *
 * Key features/differences of the Model 540 video board include:
 *
 *      2K (8 pages) of video memory located at 0xD000-0xD7FF
 *      Two display modes: 32 rows x 64 cols (default on power up), and 32 rows x 32 cols
 *      64 bytes per screen row, regardless which display mode is selected
 *      The following options can be selected via WRITE to port address 0xDE00:
 *          Bit 0: clear to enable 32/64 mode (default on power up), set to enable 32/32
 *          Bit 1: 1=tone on (542 keyboard)
 *          Bit 2: 1=color on (Rev. B only?)
 *          bit 3: 1=enable 38-40Khz AC Home control output (Rev. B only?)
 *      Video timing counter status via READ from port address 0xDE00:
 *          Bit 7: 0 for 1/120 second, then 1 for 1/120 second, based on video clock (60Hz)
 *
 * @constructor
 * @extends Component
 */
function C1PVideo(parmsVideo, eCanvas, context, imgChars)
{
    Component.call(this, "C1PVideo", parmsVideo);

    this.nDefaultModel = parmsVideo['model'];
    this.nDefaultCols = parmsVideo['charCols'];
    this.nDefaultRows = parmsVideo['charRows'];

    this.cxScreen = parmsVideo['screenWidth'];
    this.cyScreen = parmsVideo['screenHeight'];

    /*
     * These (source) character dimensions are tentative, and may not even be provided,
     * but they will become definitive once imgChars has finished loading and setReady() is called.
     */
    this.cxChar = parmsVideo['charWidth'];
    this.cyChar = parmsVideo['charHeight'];

    /*
     * This is a preliminary call to setDimensions(), to initialize default screen buffer and
     * window dimensions.  A more extensive call to setDimensions() will take place when setModel()
     * is called later, from reset() and possibly via the tripGuard() handler.
     *
     * This preliminary call merely establishes a default screen buffer size, so that when
     * setBuffer() is called, it's able to verify the assigned address space is at least as big
     * as the screen buffer.
     */
    this.setDimensions();

    this.eCanvas = eCanvas;
    this.context = context;
    this.imgChars = imgChars;

    /*
     * QUESTION: Does this video port exist only on the Model 540?
     */
    this.addrVideoPort = 0xDE00;        // WARNING: Hard-coded port address -JP
}

Component.subclass(Component, C1PVideo);

/**
 * @this {C1PVideo}
 * @param {boolean} [fPowerOn] is true for the initial reset, so that we have
 * the option of rendering "random" graphic characters, just like the real machine would do.
 */
C1PVideo.prototype.reset = function(fPowerOn)
{
    this.setModel(this.nDefaultModel);

    if (this.abMem) {
        /*
         * Let's treat every reset like a power-cycle, just for fun.
         * If you don't think that's fun, then simply remove the next line.
         *
            fPowerOn = true;
         */
        for (var offset = this.offVideo; offset < this.offVideoLimit; offset++) {
            var b = (fPowerOn? Math.floor(Math.random() * 256) : 0x20);
            Component.assert(b >= 0 && b <= 255);
            this.abMem[offset] = b;
        }
    }
};

/**
 * @this {C1PVideo}
 * @param {string|null} sHTMLType is the type of the HTML control (eg, "button", "list", "text", "submit", "textarea")
 * @param {string} sBinding is the value of the 'binding' parameter stored in the HTML control's "data-value" attribute (eg, "refresh")
 * @param {Object} control is the HTML control DOM object (eg, HTMLButtonElement)
 * @return {boolean} true if binding was successful, false if unrecognized binding request
 */
C1PVideo.prototype.setBinding = function(sHTMLType, sBinding, control)
{
    switch(sBinding) {
    case "refresh":
        this.bindings[sBinding] = control;
        control.onclick = function(video) {
            return function() {
                if (DEBUG) video.println("refreshScreen()");
                video.initScreen();
                video.updateScreen();
            };
        }(this);
        return true;
    default:
        break;
    }
    return false;
};

/**
 * @this {C1PVideo}
 * @param {Array} abMemory
 * @param {number} start
 * @param {number} end
 * @param {C1PCPU} cpu
 */
C1PVideo.prototype.setBuffer = function(abMemory, start, end, cpu)
{
    this.abMem = abMemory;
    this.offVideo = start;
    this.cbVideo = end - start + 1;
    this.offVideoLimit = this.offVideo + this.cbVideo;
    Component.assert(this.cbScreen <= this.cbVideo, "screen size (0x" + this.cbScreen.toString(16) + ") exceeds video buffer size (0x" + this.cbVideo.toString(16) + ")");
    if (cpu) {
        this.cpu = cpu;
        if (this.addrVideoPort !== undefined) {
            cpu.addReadNotify(this.addrVideoPort, this.addrVideoPort, this, this.getByte);
            cpu.addWriteNotify(this.addrVideoPort, this.addrVideoPort, this, this.setByte);
        }
    }
    this.reset(true);
};

/**
 * @this {C1PVideo}
 * @param {number|undefined} [nCols] (default is nDefaultCols)
 * @param {number|undefined} [nRows] (default is nDefaultRows)
 * @param {number|undefined} [iRowTop] (eg, 4; default is 0)
 * @param {number|undefined} [nRowsVisible] (eg, 24; default is nRows)
 */
C1PVideo.prototype.setDimensions = function(nCols, nRows, iRowTop, nRowsVisible)
{
    this.nCols = (nCols !== undefined? nCols : this.nDefaultCols);
    this.nRows = (nRows !== undefined? nRows : this.nDefaultRows);
    this.cbScreen = this.nCols * this.nRows;
    this.offVideoLimit = this.offVideo + this.cbScreen;
    /*
     * Set the first visible row and total visible rows next
     */
    this.iRowTop = (iRowTop !== undefined? iRowTop : 0);
    this.nRowsVisible = (nRowsVisible !== undefined? nRowsVisible : nRows);
    this.setDrawingDimensions();
};

/**
 * @this {C1PVideo}
 *
 * cxScreen and cyScreen give us the overall dimensions of the destination surface.  Dividing that by the number of
 * columns and rows yields a target cell size (cxCharDst,cyCharDst), which may or may not map 1-1 to the source cell size
 * (cxChar,cyChar).
 */
C1PVideo.prototype.setDrawingDimensions = function()
{
    this.cxCharDst = Math.floor(this.cxScreen / this.nCols);
    this.cyCharDst = Math.floor(this.cyScreen / this.nRowsVisible);
};

/**
 * @this {C1PVideo}
 */
C1PVideo.prototype.setFocus = function()
{
    this.eCanvas.focus();
};

/**
 * @this {C1PVideo}
 * @param {number} nModel
 */
C1PVideo.prototype.setModel = function(nModel)
{
    this.nModel = nModel;
    /*
     * Default to model 600 behavior (1K video buffer);
     * the only other supported model is 540 (2K video buffer).
     */
    if (this.nModel == 600) {
        this.setDimensions(this.nDefaultCols, this.nDefaultRows, 4, 25);
        if (this.cbScreen == 1024 && this.cpu) {
            /*
             * NOTE: We deliberately set the guard address to the LAST byte of the 2K
             * buffer range, not the FIRST byte, which has the same effect but with the
             * added benefit of deferring any screen update until after the "Model 540"
             * screen initialization code has completely blanked the entire 2K buffer,
             * avoiding a brief flicker of unsightly characters.
             */
            this.addrGuard = this.offVideoLimit + this.cbScreen - 1;
            this.cpu.addWriteNotify(this.addrGuard, this.addrGuard, this, this.tripGuard);
        }
    }
    else {
        this.println("updated video model: " + this.nModel);
        this.setDimensions(64, 32);
    }
    this.initScreen();
    this.updateScreen();
};

/**
 * @this {C1PVideo}
 * @param {boolean} fOn
 * @param {C1PComputer} cmp
 */
C1PVideo.prototype.setPower = function(fOn, cmp)
{
    /*
     * NOTE: No one should be calling power(true) before first checking isReady(), but we check
     * it ourselves, too.  This also means that updateScreen() need check only fPower and not isReady(),
     * since we guarantee that the former implies the latter.
     */
    if (fOn && !this.aFlags.fPowered && this.isReady()) {
        this.aFlags.fPowered = true;
        if (DEBUGGER) this.dbg = cmp.getComponentByType("debugger");
        /*
         * If we have an associated keyboard, then ensure that the keyboard will be notified whenever
         * the canvas gets focus and receives input.
         *
         * Also, when simulating a Model 540 video board, we need to access to the Keyboard component due
         * to some shared I/O responsibilities; ie, bit 1 of the video control port at 0xDE00 enables whatever
         * tone has been selected via the keyboard frequency port at 0xDF01 (frequency == 49152/n, where n
         * is the value stored at 0xDF01).
         */
        this.kbd = cmp.getComponentByType("keyboard");
        if (this.kbd) {
            this.kbd.setBinding("canvas", "keyDown", this.eCanvas);
            this.kbd.setBinding("canvas", "keyPress", this.eCanvas);
            this.kbd.setBinding("canvas", "keyUp", this.eCanvas);
        }
    }
    else
    if (!fOn && this.aFlags.fPowered) {
        this.aFlags.fPowered = false;
        /*
         * This is where we would add some method of blanking the display, without the disturbing the video
         * buffer contents, and blocking all further updates to the display.
         */
    }
};

/**
 * @this {C1PVideo}
 *
 * cxChar and cyChar are the source cell size. Originally, those values came strictly from the parmsVideo
 * 'charWidth' and 'charHeight' properties. Now, if those aren't defined (which is normally the case now),
 * then we infer the source cell size from the dimensions of imgChars, which is expected to be a 16x16 array of
 * character bitmaps.  We could be even more flexible, by allowing imgChars to be any rectangular dimension
 * (eg, 1x256) as long as we can assume it contains exactly 256 characters, but there's no need to get carried away....
 */
C1PVideo.prototype.setReady = function()
{
    if (!this.cxChar) this.cxChar = Math.floor(this.imgChars.width / 16);
    if (!this.cyChar) this.cyChar = Math.floor(this.imgChars.height / 16);
    Component.prototype.setReady.call(this);
};

/**
 * @this {C1PVideo}
 * @param {number} addr (ie, addrVideoPort)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified addr)
 *
 * NOTE: Ordinarily, I wouldn't allow Debugger writes (addrFrom === undefined) to interfere with the simulated
 * hardware state, but for now, I find it useful to be able to prod the simulation code directly from the Debugger.
 */
C1PVideo.prototype.getByte = function(addr, addrFrom)
{
    var b = this.cpu.getByte(addr);
    if (addrFrom !== undefined) {
        if (DEBUGGER && this.dbg) this.dbg.messageIO(this, addr, addrFrom, this.dbg.MESSAGE_VIDEO);
    }
    /*
     * The only documented READ bit in addrVideoPort is bit 7, which is supposed to alternate between
     * 0 and 1 every 1/120 of a second.  There's no way we're going to add special code to the emulator to update
     * this stupid byte every 8,333 cycles (assuming 1Mhz operation), so clearly we're going to fake it.
     *
     * Faking it means that any polling code will unavoidably get a stale value the FIRST time it reads bit 7.
     * However, we can still do a pretty good job of faking any EXTENSIVE polling: get the number of cycles
     * executed so far, divide that by 8333, floor the quotient, and then set/clear bit 7 according to whether the
     * result is odd/even.
     */
    var nCyclesHigh = Math.floor(this.cpu.getCycles() / 8333);
    this.cpu.setByte(addr, (b & 0x7F) | ((nCyclesHigh & 0x1)? 0x80 : 0));
};

/**
 * @this {C1PVideo}
 * @param {number} addr (ie, addrVideoPort)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to write the specified addr)
 */
C1PVideo.prototype.setByte = function(addr, addrFrom)
{
    if (addrFrom !== undefined) {
        if (DEBUGGER && this.dbg) this.dbg.messageIO(this, addr, addrFrom, this.dbg.MESSAGE_VIDEO);
    }
};

/**
 * @this {C1PVideo}
 * @param {number} addr (ie, addrGuard)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified addr)
 */
C1PVideo.prototype.tripGuard = function(addr, addrFrom)
{
    /*
     * Don't trigger any further hardware emulation (beyond what we've already stored in memory) if
     * the Debugger performed this read (need a special Debugger I/O command if/when you really want to do that).
     */
    if (addrFrom !== undefined) {
        if (DEBUGGER && this.dbg) this.dbg.messageIO(this, addr, addrFrom, this.dbg.MESSAGE_VIDEO, true);
        /*
         * The CPU has just written to the guard address we established just beyond the video buffer's 1K boundary,
         * implying that the system thinks we have a 2K buffer instead.  So we bump our model to 540, bump the
         * associated keyboard model to 542, and remove this guard handler.
         */
        this.setModel(540);
        if (this.kbd) this.kbd.setModel(542);
        this.cpu.removeWriteNotify(this.addrGuard, this.addrGuard, this, this.tripGuard);
    }
};

/**
 * @this {C1PVideo}
 */
C1PVideo.prototype.initScreen = function()
{
    this.abScreen = new Array(this.cbScreen);
    for (var offset=0; offset <= this.cbScreen; offset++) {
        this.abScreen[offset] = -1; // initialize every cell of the screen to an invalid value
    }
};

/**
 * updateScreen() updates the screen buffer from the video buffer and updates the window with any changes.
 *
 * @this {C1PVideo}
 * @return {boolean}
 *
 * For every byte in the video buffer, this renders it if it differs from the byte stored in the screen buffer,
 * and then updates the screen buffer to match.  Since initScreen() sets every byte in the screen buffer
 * to an illegal byte value (ie, a value which is outside the byte range 0x00-0xff), that assures the first call
 * to updateScreen() will redraw every byte in the video buffer.
 */
C1PVideo.prototype.updateScreen = function()
{
    var offset = 0;
    if (this.aFlags.fPowered) {
        while (offset < this.cbScreen) {
            var b = this.abMem[this.offVideo + offset];
            if (this.abScreen[offset] != b) {
                if (!this.writeByte(offset, b)) {
                    break;
                }
                this.abScreen[offset] = b;
            }
            offset++;
        }
    }
    return (offset == this.cbScreen);
};

/**
 * @this {C1PVideo}
 * @param {number} offset
 * @param {number} b
 * @return {boolean}
 */
C1PVideo.prototype.writeByte = function(offset, b)
{
    var col = offset % this.nCols;
    var row = Math.floor(offset / this.nCols);
    // if (b == 0) this.cpu.halt();         // I must have been testing something here...
    return this.updateWindow(col, row, b);
};

/**
 * updateWindow() updates a particular position (row,col) in the associated window with the given byte (b)
 *
 * @this {C1PVideo}
 * @param {number} col
 * @param {number} row
 * @param {number} b
 * @return {boolean} true if successful, false if not
 *
 * I originally used (screenWidth,screenHeight) == (512,448) and (cols,rows) == (32,32) and (cxChar,cyChar) == (16,16),
 * and I simply copied the source cells 1-to-1 to the destination (16,16), knowing that we would never try to display more
 * than 28 rows (the last 4 rows of the 32 possible rows were never used to display any content).  However, I should still
 * have ignored any attempt to draw past row 28 (aka screenHeight 448).  I now perform row clipping and biasing, according
 * to the first visible row (iRowTop) and total visible rows (nRowsVisible).
 *
 * Moreover, I no longer copy the source cell images to the destination 1-to-1.  I calculate (cxCharDst,cyCharDst) separately
 * (see setDrawingDimensions).  And I no longer assume that (cxChar,cyChar) are (16,16); once the source image file has finished
 * loading, I calculate (cxChar,cyChar) based on the size of image file (see setReady).  I made this change when I created
 * chargen1x.png.  In fact, at first I thought I might be able to eliminate chargen2x.png and just let drawImage() scale up
 * the individual character images from (8,8) to (16,16) or whatever (cxCharDst,cyCharDst) size was needed, but the results were
 * fuzzy, so it's still best to use chargen2x.png when using larger window sizes.
 */
C1PVideo.prototype.updateWindow = function(col, row, b)
{
    if (row >= this.iRowTop) {
        row -= this.iRowTop;
        if (row < this.nRowsVisible) {
            var xChar = (b * this.cxChar);
            var ySrc = Math.floor(xChar / this.imgChars.width) * this.cyChar;
            var xSrc = xChar % this.imgChars.width;
            var xDst = col * this.cxCharDst;
            var yDst = row * this.cyCharDst;
            // if (DEBUG) this.log("updateWindow(" + col + "," + row + "," + b +"): drawing from " + xSrc + "," + ySrc + " to " + xDst + "," + yDst);
            this.context.drawImage(this.imgChars, xSrc, ySrc, this.cxChar, this.cyChar, xDst, yDst, this.cxCharDst, this.cyCharDst);
        }
    }
    return true;
};

/**
 * C1PVideo.init()
 *
 * This function operates on every HTML element of class "video", extracting the
 * JSON-encoded parameters for the C1PVideo constructor from the element's "data-value"
 * attribute, invoking the constructor to create a C1PVideo component, and then binding
 * any associated HTML controls to the new component.
 */
C1PVideo.init = function()
{
    var aeVideo = Component.getElementsByClass(window.document, C1PJSCLASS, "video");
    for (var iVideo=0; iVideo < aeVideo.length; iVideo++) {
        var eVideo = aeVideo[iVideo];
        var parmsVideo = Component.getComponentParms(eVideo);

        /*
         * As noted in keyboard.js, the keyboard on an iOS device pops up with the SHIFT key depressed,
         * which is not the initial keyboard state that the C1P expects. I originally tried to fix that by
         * adding an 'autocapitalize="off"' attribute alongside the 'contenteditable="true"' attribute
         * on the <canvas> element, but apparently Safari honors that only inside certain elements (eg, <input>).
         *
         * I've since settled on a better work-around in keyboard.js, so I've stopped worrying about how to make
         * "autocapitalize" work here.
         */
        var eCanvas = window.document.createElement("canvas");
        if (eCanvas === undefined) {
            eVideo.innerHTML = "<br/>Missing &lt;canvas&gt; support; try a new web browser.";
            return;
        }
        eCanvas.setAttribute("class", C1PJSCLASS + "-canvas");
        eCanvas.setAttribute("width", parmsVideo['screenWidth']);
        eCanvas.setAttribute("height", parmsVideo['screenHeight']);

        eCanvas.setAttribute("contenteditable", "true");
        eCanvas.setAttribute("autocapitalize", "off");
        eCanvas.setAttribute("autocorrect", "off");
        eCanvas.style.backgroundColor = parmsVideo['screenColor'];

        /*
         * HACK: A canvas style of "auto" provides for excellent responsive canvas scaling in EVERY browser
         * except IE9/IE10, so I recalculate the appropriate CSS height every time the parent DIV is resized;
         * IE11 works without this hack, so we take advantage of the fact that IE11 doesn't report itself as "MSIE".
         */
        eCanvas.style.height = "auto";
        if (web.getUserAgent().indexOf("MSIE") >= 0) {
            eCanvas.style.height = (((eVideo.clientWidth * parmsVideo['screenHeight']) / parmsVideo['screenWidth']) | 0) + "px";
            eVideo.onresize = function(eParent, eChild, cx, cy) {
                return function() {
                    eChild.style.height = (((eParent.clientWidth * cy) / cx) | 0) + "px";
                };
            }(eVideo, eCanvas, parmsVideo['screenWidth'], parmsVideo['screenHeight']);
        }
        eVideo.appendChild(eCanvas);

        /*
         * Now we can create the Video object, record it, and wire it up to the associated document elements.
         *
         * Regarding "new Image()", see https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement.Image:
         *
         *      This constructor exists for historical reasons only and returns an HTMLImageElement instance just as
         *      document.createElement('img') would.
         */
        var imgCharSet = new Image();
        var contextVideo = eCanvas.getContext("2d");
        var video = new C1PVideo(parmsVideo, eCanvas, contextVideo, imgCharSet);
        imgCharSet.onload = function(video, sCharSet) {
            return function() {
                if (DEBUG) video.log("onload(): finished loading " + sCharSet);
                video.setReady();
            };
        }(video, parmsVideo['charSet']);        // jshint ignore:line
        imgCharSet.src = parmsVideo['charSet'];

        /*
         * Bind any video-specific controls (eg, the Refresh button). There are no essential controls, however;
         * even the "Refresh" button is just a diagnostic tool, to verify that the screen contents are up-to-date.
         */
        Component.bindComponentControls(video, eVideo, C1PJSCLASS);
    }
};

/*
 * Initialize every Video module on the page.
 */
web.onInit(C1PVideo.init);
